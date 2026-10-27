package edu.srmap.campuscare.ui.components

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
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
import androidx.compose.material.icons.rounded.CheckCircle
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import edu.srmap.campuscare.BuildConfig
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.delay

/**
 * Narrowly scoped JavaScript bridge for Cloudflare Turnstile callbacks.
 * Returns the challenge token to the native Kotlin caller on the main thread.
 */
class TurnstileBridge(
    private val onToken: (String) -> Unit,
    private val onError: (String) -> Unit,
    private val onLoaded: () -> Unit,
    /** Background mode: the page refreshes the token itself, so expiry is not an error. */
    private val onExpire: (() -> Unit)? = null,
    /** Background mode: Cloudflare needs the person to interact (true) or is done with that (false). */
    private val onInteractive: ((Boolean) -> Unit)? = null,
) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onToken(token: String) {
        main.post { onToken.invoke(token) }
    }

    @JavascriptInterface
    fun onExpired() {
        main.post { onExpire?.invoke() ?: onError.invoke("The security verification expired. Please try again.") }
    }

    @JavascriptInterface
    fun onInteractive(value: String?) {
        main.post { onInteractive?.invoke(value == "1") }
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

enum class TurnstilePhase { Verifying, Ready, Refreshing, Interactive, Failed }

/**
 * Cloudflare Turnstile state for Android forms.
 *
 * With a [TurnstileInline] widget on screen, verification runs in the background while the form is
 * filled in, and [run] uses the token that is already waiting (or waits only until it arrives). Tokens
 * are single use and expire after 300 s, so each one is handed out once and the widget then prepares
 * the next. Without an inline widget, [run] shows the [TurnstileHost] dialog as before. If Turnstile is
 * disabled or unconfigured, the block runs immediately with null. The server verifies every token.
 */
class TurnstileState(
    val enabled: Boolean,
    val action: String,
    val pageUrl: String,
    private val clock: () -> Long = { SystemClock.elapsedRealtime() },
) {
    var pending by mutableStateOf<((String?) -> Unit)?>(null)
        private set

    /** True while a [TurnstileInline] widget for this form is on screen. */
    var inline by mutableStateOf(false)
        internal set
    var phase by mutableStateOf(TurnstilePhase.Verifying)
        internal set
    var error by mutableStateOf<String?>(null)
        internal set

    /** Bumped when the inline widget should produce a fresh token (after one was used or went stale). */
    var resetRequests by mutableIntStateOf(0)
        private set

    private var token: String? = null
    private var tokenAtMs = 0L
    private var pendingSinceMs = 0L
    internal var startedAtMs = clock()

    /** Restarts the "time to token" measurement (diagnostics only). */
    internal fun restartTiming() {
        startedAtMs = clock()
    }

    fun run(block: (String?) -> Unit) {
        if (!enabled) return block(null)
        val now = clock()
        val ready = token?.takeIf { now - tokenAtMs < TOKEN_MAX_AGE_MS }
        if (inline && ready != null) {
            debug("submit: token was ready (${(now - tokenAtMs) / 1000}s old)")
            prepareNext()
            block(ready)
            return
        }
        if (inline && token != null) prepareNext() // too old to trust: get a new one
        debug("submit: waiting for token")
        pendingSinceMs = now
        pending = block
    }

    internal fun complete(token: String?) {
        val now = clock()
        val cb = pending
        if (cb != null) {
            pending = null
            if (token != null) {
                debug("token handed to waiting submit after ${now - pendingSinceMs}ms")
                if (inline) prepareNext()
                cb.invoke(token)
            }
        } else if (token != null) {
            debug("token ready ${now - startedAtMs}ms after the widget started")
            this.token = token
            tokenAtMs = now
            phase = TurnstilePhase.Ready
        }
    }

    internal fun expired() {
        token = null
        phase = TurnstilePhase.Refreshing // the page refreshes it automatically ('refresh-expired': 'auto')
    }

    internal fun failed(message: String) {
        token = null
        error = message
        phase = TurnstilePhase.Failed
        debug("failed: $message")
    }

    /** Discards the current token (it is single use) and asks the inline widget for the next one. */
    private fun prepareNext() {
        token = null
        phase = TurnstilePhase.Refreshing
        startedAtMs = clock()
        resetRequests++
    }

    fun cancel() {
        complete(null)
    }

    private fun debug(msg: String) {
        // Timings and states only: never the token.
        if (BuildConfig.DEBUG) Log.d("CampusCareTurnstile", "[$action] $msg")
    }

    companion object {
        /** Cloudflare tokens live 300 s; leave room for the request to reach Siteverify. */
        const val TOKEN_MAX_AGE_MS = 270_000L
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
    // An inline widget already runs the check on the form itself.
    if (state.pending == null || state.inline) return

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

/** Navigation stays on the API host (which serves the widget page) and Cloudflare's challenge hosts. */
private fun turnstileClient(approvedApiHost: String, onMainFrameError: () -> Unit) = object : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val host = request?.url?.host?.lowercase() ?: return true
        val allowed = host == approvedApiHost || host == "challenges.cloudflare.com" || host.endsWith(".cloudflare.com")
        return !allowed
    }

    override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
        if (request?.isForMainFrame == true) onMainFrameError()
    }
}

/**
 * Turnstile that runs in the background while the form is being filled in (Managed widget,
 * "interaction-only" appearance): normally just a one-line status, and expanded only when Cloudflare
 * asks the person to interact. Keep it in composition for the life of the form so it is not
 * recreated, and call [TurnstileState.run] from the submit button as usual.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun TurnstileInline(state: TurnstileState, modifier: Modifier = Modifier) {
    if (!state.enabled) return
    DisposableEffect(state) {
        state.inline = true
        onDispose { state.inline = false }
    }
    var interactive by remember { mutableStateOf(false) }
    var reloads by remember { mutableIntStateOf(0) }
    // If a submit has waited this long, show the widget in case Cloudflare drew a challenge without
    // reporting it (e.g. an API that predates background mode always renders the visible widget).
    var waitedLong by remember { mutableStateOf(false) }
    LaunchedEffect(state.pending) {
        waitedLong = false
        if (state.pending != null) {
            delay(6_000)
            waitedLong = true
        }
    }
    val url = remember(state.pageUrl) { Uri.parse(state.pageUrl).buildUpon().appendQueryParameter("mode", "background").build().toString() }
    val approvedHost = remember(url) { Uri.parse(url).host?.lowercase().orEmpty() }
    val expanded = interactive || (waitedLong && state.pending != null && state.phase != TurnstilePhase.Failed)

    Column(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
            when (state.phase) {
                TurnstilePhase.Ready -> Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = CcColors.Emerald, modifier = Modifier.size(16.dp))
                TurnstilePhase.Failed -> Icon(Icons.Rounded.Warning, contentDescription = null, tint = CcColors.Sos, modifier = Modifier.size(16.dp))
                else -> CircularProgressIndicator(modifier = Modifier.size(14.dp), color = CcColors.Emerald, strokeWidth = 2.dp)
            }
            Spacer(Modifier.width(8.dp))
            Text(
                when {
                    state.phase == TurnstilePhase.Failed -> state.error ?: "Security check failed."
                    interactive -> "Complete the security check below."
                    state.phase == TurnstilePhase.Ready -> "Security check complete."
                    state.phase == TurnstilePhase.Refreshing -> "Refreshing security check…"
                    else -> "Verifying security…"
                },
                style = MaterialTheme.typography.bodySmall,
                color = if (state.phase == TurnstilePhase.Failed) CcColors.Sos else CcColors.InkSoft,
                modifier = Modifier.weight(1f),
            )
            if (state.phase == TurnstilePhase.Failed) {
                TextButton(onClick = {
                    state.error = null
                    state.phase = TurnstilePhase.Verifying
                    state.restartTiming()
                    reloads++
                }) { Text("Retry") }
            }
        }
        AndroidView(
            modifier = Modifier.fillMaxWidth().height(if (expanded) 72.dp else 1.dp),
            factory = { ctx ->
                WebView(ctx).apply {
                    setBackgroundColor(android.graphics.Color.TRANSPARENT)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    addJavascriptInterface(
                        TurnstileBridge(
                            onToken = { token ->
                                interactive = false
                                state.complete(token)
                            },
                            onError = { message -> state.failed(message) },
                            onLoaded = {},
                            onExpire = { state.expired() },
                            onInteractive = { on ->
                                interactive = on
                                if (on) state.phase = TurnstilePhase.Interactive
                            },
                        ),
                        "CampusCareAndroid",
                    )
                    webViewClient = turnstileClient(approvedHost) { state.failed("Unable to reach the verification service. Check your connection.") }
                    tag = 0 to 0
                    loadUrl(url)
                }
            },
            update = { view ->
                @Suppress("UNCHECKED_CAST")
                val tagPair = view.tag as Pair<Int, Int>
                val seenResets = tagPair.first
                val seenReloads = tagPair.second
                if (reloads != seenReloads) {
                    view.reload()
                } else if (state.resetRequests != seenResets) {
                    // Pages served before background mode have no ccReset: reload them instead.
                    view.evaluateJavascript("(function(){ if (window.ccReset) { ccReset(); return 'ok'; } return 'missing'; })()") { result ->
                        if (result?.contains("missing") == true) view.reload()
                    }
                }
                view.tag = state.resetRequests to reloads
            },
            onRelease = { it.destroy() },
        )
    }
}
