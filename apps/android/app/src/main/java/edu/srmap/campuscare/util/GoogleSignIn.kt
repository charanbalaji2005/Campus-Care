package edu.srmap.campuscare.util

import android.content.Context
import android.util.Base64
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialInterruptedException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import edu.srmap.campuscare.AppAudience
import edu.srmap.campuscare.BuildConfig
import java.security.SecureRandom

/** Why native Google sign-in did not produce an ID token. */
enum class GoogleFailure {
    /** This build has no web client ID. */
    NotConfigured,
    /** Google returned no account: none on the phone, or this app's package + signing SHA-1 is not registered. */
    NoAccount,
    /** Google reported the app is not registered (developer console error). */
    AppNotRegistered,
    /** No Google Play services / Credential Manager provider on this phone. */
    Unavailable,
    /** The system interrupted the request; trying again usually works. */
    Interrupted,
    Other,
}

sealed interface GoogleResult {
    data class Token(val idToken: String, val nonce: String) : GoogleResult
    data object Cancelled : GoogleResult
    data class Failed(val reason: GoogleFailure, val message: String) : GoogleResult {
        val retryable: Boolean get() = reason == GoogleFailure.Interrupted || reason == GoogleFailure.Other || reason == GoogleFailure.NoAccount
    }
}

/** User-facing wording for native Google sign-in failures. Pure, so it is unit-tested. */
object GoogleSignInMessages {
    private val DEVELOPER_ERROR = Regex("28444|developer console|DEVELOPER_ERROR|not set up correctly", RegexOption.IGNORE_CASE)

    /** [raw] is the system's message (never a token); [packageName] is this app's own ID, shown so IT can register it. */
    fun failure(reason: GoogleFailure, raw: String?, packageName: String, domain: String): GoogleResult.Failed {
        val r = if (raw != null && DEVELOPER_ERROR.containsMatchIn(raw)) GoogleFailure.AppNotRegistered else reason
        val message = when (r) {
            GoogleFailure.NotConfigured -> "Google sign-in isn't available in this version of the app. Sign in with your email and password."
            GoogleFailure.AppNotRegistered -> "Google sign-in isn't set up for this app yet. Sign in with your email and password, and let campus IT know (app ID: $packageName)."
            GoogleFailure.NoAccount -> "No Google account was offered. Add your @$domain Google account to this phone (Settings › Accounts), then try again. " +
                "If it's already there, Google sign-in may not be set up for this app yet (app ID: $packageName) — use your email and password."
            GoogleFailure.Unavailable -> "Google sign-in needs Google Play services on this phone. Sign in with your email and password instead."
            GoogleFailure.Interrupted -> "Google sign-in was interrupted. Please try again."
            GoogleFailure.Other -> "Google sign-in didn't work. Try again, or sign in with your email and password."
        }
        return GoogleResult.Failed(r, message)
    }
}

/**
 * Native "Sign in with Google" via Credential Manager, used by both CampusCare Student and
 * CampusCare College. The ID token is requested for the WEB client ID (the audience the server
 * trusts) and sent to POST /auth/google/mobile, which verifies it and applies the app's account rules.
 *
 * Google only returns a token when this app's package name and signing certificate SHA-1 are
 * registered as an Android OAuth client in the same Google Cloud project as that web client —
 * each app (in.edu.srmap.campuscare and in.edu.srmap.campuscare.college) needs its own registration.
 */
object GoogleSignIn {
    private const val TAG = "GoogleSignIn"
    val configured: Boolean get() = BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()

    suspend fun signIn(activityContext: Context): GoogleResult {
        val pkg = activityContext.packageName
        val domain = BuildConfig.ACCOUNT_EMAIL_DOMAIN
        if (!configured) return GoogleSignInMessages.failure(GoogleFailure.NotConfigured, null, pkg, domain)
        val nonce = ByteArray(24).also { SecureRandom().nextBytes(it) }.let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) }

        val googleIdOption = GetGoogleIdOption.Builder()
            .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .setNonce(nonce)
            .build()

        val signInWithGoogleOption = GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setNonce(nonce)
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .addCredentialOption(signInWithGoogleOption)
            .build()

        return try {
            val result = CredentialManager.create(activityContext).getCredential(activityContext, request)
            val credential = result.credential
            if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                GoogleResult.Token(GoogleIdTokenCredential.createFrom(credential.data).idToken, nonce)
            } else {
                GoogleSignInMessages.failure(GoogleFailure.Other, "Unexpected credential type: ${credential.type}", pkg, domain)
            }
        } catch (e: GetCredentialCancellationException) {
            GoogleResult.Cancelled
        } catch (e: GetCredentialException) {
            // Logs the system's reason (never a token) so a configuration problem is easy to spot in logcat.
            Log.w(TAG, "Credential Manager failed for $pkg: ${e.type}: ${e.message}")
            val reason = when (e) {
                is NoCredentialException -> GoogleFailure.NoAccount
                is GetCredentialInterruptedException -> GoogleFailure.Interrupted
                is GetCredentialProviderConfigurationException, is GetCredentialUnsupportedException -> GoogleFailure.Unavailable
                else -> GoogleFailure.Other
            }
            GoogleSignInMessages.failure(reason, e.message, pkg, domain)
        }
    }

    /**
     * Whether a failed native attempt may fall back to the browser OAuth flow. Only CampusCare Student
     * keeps that older fallback; CampusCare College always stays in the app and explains the failure.
     */
    fun browserFallbackAllowed(audience: AppAudience) = audience == AppAudience.Student
}
