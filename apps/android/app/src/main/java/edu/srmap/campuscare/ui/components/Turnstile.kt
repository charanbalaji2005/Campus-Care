package edu.srmap.campuscare.ui.components

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import edu.srmap.campuscare.ui.theme.CcColors

/**
 * Narrowly scoped JavaScript bridge for Cloudflare Turnstile callbacks.
 * Returns the challenge token to the native Kotlin caller on the main thread.
 */
class TurnstileBridge(
    private val onToken: (String) -> Unit,
    private val onError: (String) -> Unit,
    private val onLoaded: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onToken(token: String) {
        main.post { onToken.invoke(token) }
    }

    @JavascriptInterface
    fun onExpired() {
        main.post { onError.invoke("The security verification expired. Please try again.") }
    }

    @JavascriptInterface
    fun onExpired(@Suppress("UNUSED_PARAMETER") ignored: String?) {
        onExpired()
    }

    @JavascriptInterface
    fun onError(code: String) {
        val userFriendly = when (code) {
            "script_load_error", "turnstile_not_available" -> "Verification service temporarily unreachable. Check your connection."
            else -> "Verification failed ($code). Please retry."
        }
        main.post { onError.invoke(userFriendly) }
    }

    @JavascriptInterface
    fun onLoaded() {
        main.post { onLoaded.invoke() }
    }

    @JavascriptInterface
    fun onLoaded(@Suppress("UNUSED_PARAMETER") ignored: String?) {
        onLoaded()
    }
}

/**
 * Cloudflare Turnstile state for Android forms.
 * When enabled for [action], [run] displays a hosted WebView verification dialog and yields a fresh,
 * single-use token upon completion. If Turnstile is disabled or unconfigured, the block runs immediately with null.
 */
class TurnstileState(val enabled: Boolean, val action: String, val pageUrl: String) {
    var pending by mutableStateOf<((String?) -> Unit)?>(null)
        private set

    fun run(block: (String?) -> Unit) {
        if (!enabled) block(null) else pending = block
    }

    internal fun complete(token: String?) {
        val cb = pending
        pending = null
        if (token != null) cb?.invoke(token)
    }

    fun cancel() {
        complete(null)
    }
}

@Composable
fun rememberTurnstile(form: String): TurnstileState {
    val app = LocalApp.current
    val settings = app.config.config.value.settings.turnstile
    val enabled = settings.enabled && when (form) {
        "register" -> settings.forms.register
        "login" -> settings.forms.login
        "forgotPassword" -> settings.forms.forgotPassword
        "resetPassword" -> settings.forms.resetPassword
        "resendVerification" -> settings.forms.resendVerification
        "incidentSubmit" -> settings.forms.incidentSubmit
        "communityPost" -> settings.forms.communityPost
        else -> false
    }
    val url = app.client.url("/mobile/turnstile?action=$form")
    return remember(enabled, form, url) { TurnstileState(enabled, form, url) }
}

/**
 * Android WebView host displaying the hosted Cloudflare Turnstile challenge.
 * Enforces origin validation on navigation, JavaScript / DOM storage requirements,
 * accessible loading states, error/retry states, and resets on failure.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun TurnstileHost(state: TurnstileState) {
    if (state.pending == null) return

    var error by remember { mutableStateOf<String?>(null) }
    var isLoaded by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }

    val pageUri = remember(state.pageUrl) { Uri.parse(state.pageUrl) }
    val approvedApiHost = pageUri.host?.lowercase().orEmpty()

    Dialog(
        onDismissRequest = { state.cancel() },
        properties = DialogProperties(dismissOnBackPress = true, dismissOnClickOutside = false),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Color.White)
                .padding(22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Header
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Icon(
                    Icons.Rounded.VerifiedUser,
                    contentDescription = null,
                    tint = CcColors.Emerald,
                    modifier = Modifier.size(24.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "Security Verification",
                    style = MaterialTheme.typography.titleMedium,
                    color = CcColors.Ink,
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "Protected by Cloudflare Turnstile",
                style = MaterialTheme.typography.bodySmall,
                color = CcColors.InkSoft,
            )
            Spacer(Modifier.height(16.dp))

            // Main Challenge / Loading Area
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(90.dp),
                contentAlignment = Alignment.Center,
            ) {
                // Loading spinner until widget reports onLoaded
                if (!isLoaded && error == null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            color = CcColors.Emerald,
                            strokeWidth = 2.5.dp,
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "Verifying connection...",
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                    }
                }

                // WebView with strict origin filtering
                if (error == null) {
                    AndroidView(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(90.dp),
                        factory = { ctx ->
                            WebView(ctx).apply {
                                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                                settings.javaScriptEnabled = true
                                settings.domStorageEnabled = true
                                settings.allowFileAccess = false
                                settings.allowContentAccess = false
                                
                                val bridge = TurnstileBridge(
                                    onToken = { token -> state.complete(token) },
                                    onError = { err ->
                                        error = err
                                        isLoaded = false
                                    },
                                    onLoaded = { isLoaded = true },
                                )
                                addJavascriptInterface(bridge, "CampusCareAndroid")

                                webViewClient = object : WebViewClient() {
                                    override fun shouldOverrideUrlLoading(
                                        view: WebView?,
                                        request: WebResourceRequest?,
                                    ): Boolean {
                                        val reqUrl = request?.url ?: return true
                                        val host = reqUrl.host?.lowercase().orEmpty()
                                        // Allow navigation ONLY on current API host and Cloudflare challenges host
                                        val isAllowed = host == approvedApiHost ||
                                            host == "challenges.cloudflare.com" ||
                                            host.endsWith(".cloudflare.com")
                                        return !isAllowed
                                    }

                                    override fun onReceivedError(
                                        view: WebView?,
                                        request: WebResourceRequest?,
                                        webResourceError: WebResourceError?,
                                    ) {
                                        if (request?.isForMainFrame == true) {
                                            error = "Unable to reach verification service. Check your internet connection."
                                            isLoaded = false
                                        }
                                    }
                                }

                                loadUrl(state.pageUrl)
                            }
                        },
                        update = { view ->
                            if (view.tag != attempt) {
                                view.tag = attempt
                                if (attempt > 0) {
                                    view.reload()
                                }
                            }
                        },
                    )
                }
            }

            // Error & Retry Section
            AnimatedVisibility(visible = error != null, enter = fadeIn(), exit = fadeOut()) {
                error?.let { errText ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 10.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Rounded.Warning,
                                contentDescription = null,
                                tint = CcColors.Sos,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                errText,
                                style = MaterialTheme.typography.bodySmall,
                                color = CcColors.Sos,
                            )
                        }
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = {
                                error = null
                                isLoaded = false
                                attempt++
                            },
                        ) {
                            Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Retry verification")
                        }
                    }
                }
            }

            Spacer(Modifier.height(10.dp))
            TextButton(
                onClick = { state.cancel() },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Cancel", color = CcColors.InkSoft)
            }
        }
    }
}
