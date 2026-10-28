package edu.srmap.campuscare.data

import android.os.Build
import edu.srmap.campuscare.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(
    val status: Int,
    val code: String,
    message: String,
    val fields: Map<String, String> = emptyMap(),
    /** Other primitive values from `error.details` (e.g. verificationTicket, attemptsLeft, retryAfterSeconds). */
    val details: Map<String, String> = emptyMap(),
) : Exception(message) {
    val isNetwork: Boolean get() = status == 0
}

/**
 * Talks to the CampusCare API. Every request identifies itself as the Android app and sends the
 * session as a bearer token (no cookies, so the website's CSRF scheme does not apply).
 * Responses use the API's `{ data }` / `{ error }` envelope.
 */
class ApiClient(val baseUrl: String, private val session: SessionStore, val json: Json) {
    private val userAgent = "CampusCare-Android/${BuildConfig.VERSION_NAME} (${BuildConfig.APP_AUDIENCE}; ${Build.MANUFACTURER} ${Build.MODEL}; Android ${Build.VERSION.RELEASE})"

    private val headers = Interceptor { chain ->
        val builder = chain.request().newBuilder()
            .header("X-CampusCare-Client", "android")
            // CampusCare Student or CampusCare College: the API binds the session to this app.
            .header("X-CampusCare-App", BuildConfig.APP_AUDIENCE)
            .header("X-App-Version-Code", BuildConfig.VERSION_CODE.toString())
            .header("X-Device-Name", "${Build.MANUFACTURER} ${Build.MODEL}".take(120))
            .header("User-Agent", userAgent)
            .header("Accept", "application/json")
        session.token?.let { builder.header("Authorization", "Bearer $it") }
        chain.proceed(builder.build())
    }

    /** Shared with Coil so private images (lost & found photos, chat media) load with the session. */
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .addInterceptor(headers)
        .build()

    fun url(path: String): String = baseUrl + "/api/v1" + path

    suspend inline fun <reified T> get(path: String): T = request("GET", path, null, serializer<T>())
    suspend inline fun <reified T> post(path: String, body: Any? = emptyMap<String, Any?>()): T = request("POST", path, body, serializer<T>())
    suspend inline fun <reified T> put(path: String, body: Any?): T = request("PUT", path, body, serializer<T>())
    suspend inline fun <reified T> patch(path: String, body: Any?): T = request("PATCH", path, body, serializer<T>())
    suspend inline fun <reified T> delete(path: String): T = request("DELETE", path, null, serializer<T>())

    suspend fun <T> request(method: String, path: String, body: Any?, deserializer: DeserializationStrategy<T>): T {
        val requestBody: RequestBody? = when {
            method == "GET" || method == "DELETE" -> null
            else -> toJson(body).toString().toRequestBody(JSON)
        }
        val req = Request.Builder().url(url(path)).method(method, requestBody).build()
        return execute(req, deserializer)
    }

    suspend inline fun <reified T> upload(path: String, bytes: ByteArray, fileName: String, mimeType: String, fields: Map<String, String> = emptyMap()): T {
        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            fields.forEach { (k, v) -> addFormDataPart(k, v) }
            addFormDataPart("file", fileName, bytes.toRequestBody(mimeType.toMediaType()))
        }.build()
        val req = Request.Builder().url(url(path)).post(multipart).build()
        return execute(req, serializer<T>())
    }

    /** Multipart PUT for endpoints that replace a single file (profile photo). */
    suspend inline fun <reified T> uploadPut(path: String, bytes: ByteArray, fileName: String, mimeType: String): T {
        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, bytes.toRequestBody(mimeType.toMediaType()))
            .build()
        return execute(Request.Builder().url(url(path)).put(multipart).build(), serializer<T>())
    }

    /** Raw bytes (exports, attachments). */
    suspend fun download(path: String): ByteArray = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url(path)).get().build()
        try {
            http.newCall(req).execute().use { res ->
                val bytes = res.body?.bytes() ?: ByteArray(0)
                if (!res.isSuccessful) throw parseError(res.code, String(bytes))
                bytes
            }
        } catch (e: IOException) {
            throw ApiException(0, "network", OFFLINE)
        }
    }

    suspend fun <T> execute(req: Request, deserializer: DeserializationStrategy<T>): T = withContext(Dispatchers.IO) {
        val (code, text) = try {
            http.newCall(req).execute().use { res -> res.code to (res.body?.string() ?: "") }
        } catch (e: IOException) {
            throw ApiException(0, "network", OFFLINE)
        }
        if (code !in 200..299) throw parseError(code, text)
        val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: throw ApiException(code, "bad_response", "Unexpected response from the server.")
        val data = root["data"] ?: JsonNull
        try {
            json.decodeFromJsonElement(deserializer, data)
        } catch (e: Exception) {
            throw ApiException(code, "bad_response", "The app could not read the server response. Please update the app.")
        }
    }

    private fun parseError(code: Int, text: String): ApiException {
        val err = runCatching { json.parseToJsonElement(text).jsonObject["error"]?.jsonObject }.getOrNull()
        val errCode = err?.get("code")?.jsonPrimitive?.contentOrNull ?: "http_$code"
        val message = err?.get("message")?.jsonPrimitive?.contentOrNull ?: "Something went wrong. Please try again."
        val fields = runCatching {
            err?.get("details")?.jsonObject?.get("fields")?.jsonObject?.mapValues { it.value.jsonPrimitive.contentOrNull ?: "" }
        }.getOrNull() ?: emptyMap()
        val details = runCatching {
            err?.get("details")?.jsonObject?.filterValues { it is JsonPrimitive }?.mapValues { it.value.jsonPrimitive.contentOrNull ?: "" }
        }.getOrNull() ?: emptyMap()
        if (code == 401 && (errCode == "session_expired" || errCode == "unauthorized") && session.isSignedIn) {
            session.clear(SessionEvent.Expired)
        } else if (code == 401 && errCode == "wrong_app" && session.isSignedIn) {
            session.clear(SessionEvent.WrongApp)
        }
        return ApiException(code, errCode, message, fields, details)
    }

    companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
        const val OFFLINE = "You appear to be offline. Check your connection and try again."

        /** Converts Kotlin maps/lists/primitives into JSON for request bodies. */
        fun toJson(value: Any?): JsonElement = when (value) {
            null -> JsonNull
            is JsonElement -> value
            is String -> JsonPrimitive(value)
            is Number -> JsonPrimitive(value)
            is Boolean -> JsonPrimitive(value)
            is Enum<*> -> JsonPrimitive(value.name)
            is Map<*, *> -> JsonObject(value.entries.filter { it.key != null && it.value != null }.associate { it.key.toString() to toJson(it.value) })
            is Iterable<*> -> JsonArray(value.map { toJson(it) })
            is Array<*> -> JsonArray(value.map { toJson(it) })
            else -> JsonPrimitive(value.toString())
        }
    }
}
