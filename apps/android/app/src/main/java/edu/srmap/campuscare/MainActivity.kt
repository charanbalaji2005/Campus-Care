package edu.srmap.campuscare

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import edu.srmap.campuscare.ui.navigation.AppRoot
import edu.srmap.campuscare.ui.theme.CampusCareTheme

class MainActivity : ComponentActivity() {
    private var pendingLink by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pendingLink = linkFrom(intent)
        val container = (application as CampusCareApp).container
        setContent {
            val a11y by container.a11y.collectAsState()
            CampusCareTheme(reduceMotion = a11y.reduceMotion, largeText = a11y.largeText) {
                AppRoot(container = container, pendingLink = pendingLink, onLinkHandled = { pendingLink = null })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        linkFrom(intent)?.let { pendingLink = it }
    }

    private fun linkFrom(intent: Intent?): String? {
        val data: Uri = intent?.data ?: return null
        return when (data.scheme) {
            "campuscare" -> data.getQueryParameter("link") ?: data.toString()
            "https", "http" -> data.path?.let { path -> path + (data.query?.let { "?$it" } ?: "") }
            else -> null
        }
    }
}
