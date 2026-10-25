package edu.srmap.campuscare.util

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import edu.srmap.campuscare.BuildConfig
import java.security.SecureRandom
import android.util.Base64

sealed interface GoogleResult {
    data class Token(val idToken: String, val nonce: String) : GoogleResult
    data object Cancelled : GoogleResult
    data class Failed(val message: String) : GoogleResult
}

/**
 * Native "Sign in with Google" via Credential Manager. The ID token is requested for the WEB
 * client ID (the same one the server trusts) and sent to POST /auth/google/mobile for verification.
 */
object GoogleSignIn {
    val configured: Boolean get() = BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()

    suspend fun signIn(activityContext: Context): GoogleResult {
        if (!configured) return GoogleResult.Failed("Google sign-in is not set up in this build.")
        val nonce = ByteArray(24).also { SecureRandom().nextBytes(it) }.let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) }
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .setNonce(nonce)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        return try {
            val result = CredentialManager.create(activityContext).getCredential(activityContext, request)
            val credential = result.credential
            if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                GoogleResult.Token(GoogleIdTokenCredential.createFrom(credential.data).idToken, nonce)
            } else {
                GoogleResult.Failed("Unexpected credential type.")
            }
        } catch (e: GetCredentialCancellationException) {
            GoogleResult.Cancelled
        } catch (e: NoCredentialException) {
            GoogleResult.Failed("No Google account found on this device. Add your @srmap.edu.in account in Settings.")
        } catch (e: GetCredentialException) {
            GoogleResult.Failed(e.message ?: "Google sign-in failed.")
        }
    }
}
