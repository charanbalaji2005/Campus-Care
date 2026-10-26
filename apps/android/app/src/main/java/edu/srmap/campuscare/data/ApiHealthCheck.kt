package edu.srmap.campuscare.data

import android.content.Context
import edu.srmap.campuscare.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Quick diagnostic ping to verify that the native Android app can reach the CampusCare API.
 * Uses standard HttpURLConnection and Kotlin coroutines.
 */
suspend fun checkCampusCareServer(
    context: Context,
): Result<String> = withContext(Dispatchers.IO) {
    var connection: HttpURLConnection? = null
    try {
        val baseUrl = context.getString(R.string.api_base_url)
        connection = URL("$baseUrl/api/v1/health").openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 10000
        connection.readTimeout = 10000
        val statusCode = connection.responseCode
        val stream = if (statusCode in 200..299) {
            connection.inputStream
        } else {
            connection.errorStream
        }
        val body = stream.bufferedReader().use { it.readText() }
        if (statusCode !in 200..299) {
            error("Server returned HTTP $statusCode")
        }
        val json = JSONObject(body)
        Result.success(json.optString("service", json.optString("status", "Connected")))
    } catch (e: Exception) {
        Result.failure(e)
    } finally {
        connection?.disconnect()
    }
}
