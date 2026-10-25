package edu.srmap.campuscare.ui.components

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import edu.srmap.campuscare.ui.theme.CcColors

/** Receives callbacks from the Turnstile page hosted by the API (see /api/v1/mobile/turnstile). */
class TurnstileBridge(private val onToken: (String) -> Unit, private val onError: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onToken(token: String) {
        main.post { onToken.invoke(token) }
    }

    @JavascriptInterface
    fun onExpired(@Suppress("UNUSED_PARAMETER") ignored: String) {
        main.post { onError.invoke("The check expired. Please try again.") }
    }

    @JavascriptInterface
    fun onError(code: String) {
        main.post { onError.invoke("Verification failed ($code). Check your connection and try again.") }
    }
}

/**
 * Cloudflare Turnstile for the app. When the Super Admin has enabled it for [form], [run] first
 * shows a short human-verification step and then calls the action with a fresh, single-use token;
 * otherwise the action runs immediately with null. The server always verifies the token.
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
    return remember(enabled, form) { TurnstileState(enabled, form, url) }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun TurnstileHost(state: TurnstileState) {
    if (state.pending == null) return
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableStateOf(0) }
    Dialog(onDismissRequest = { state.complete(null) }) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Color.White).padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.VerifiedUser, contentDescription = null, tint = CcColors.Emerald, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(8.dp))
                Text("Verify you are human", style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.height(4.dp))
            Text("Protected by Cloudflare Turnstile", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            Spacer(Modifier.height(12.dp))
            Box(Modifier.fillMaxWidth().height(90.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(24.dp), color = CcColors.Emerald, strokeWidth = 2.dp)
                AndroidView(
                    modifier = Modifier.fillMaxWidth().height(90.dp),
                    factory = { ctx ->
                        WebView(ctx).apply {
                            setBackgroundColor(android.graphics.Color.TRANSPARENT)
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.allowFileAccess = false
                            settings.allowContentAccess = false
                            webViewClient = WebViewClient()
                            addJavascriptInterface(
                                TurnstileBridge(onToken = { state.complete(it) }, onError = { error = it }),
                                "CampusCareAndroid",
                            )
                            loadUrl(state.pageUrl)
                        }
                    },
                    update = { view ->
                        if (view.tag != attempt) {
                            view.tag = attempt
                            if (attempt > 0) view.reload()
                        }
                    },
                )
            }
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.Sos)
                TextButton(onClick = { error = null; attempt++ }) { Text("Try again") }
            }
            TextButton(onClick = { state.complete(null) }) { Text("Cancel", color = CcColors.InkSoft) }
        }
    }
}
