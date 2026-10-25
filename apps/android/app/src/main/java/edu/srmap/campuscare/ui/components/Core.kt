package edu.srmap.campuscare.ui.components

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.navigation.NavHostController
import edu.srmap.campuscare.AppContainer
import edu.srmap.campuscare.data.ApiException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

val LocalApp = staticCompositionLocalOf<AppContainer> { error("AppContainer not provided") }
val LocalNav = staticCompositionLocalOf<NavHostController> { error("NavController not provided") }
val LocalSnack = staticCompositionLocalOf<Snack> { error("Snack not provided") }

/** App-wide snackbar messages. */
class Snack(private val scope: CoroutineScope, val host: SnackbarHostState) {
    fun show(message: String, long: Boolean = false) {
        scope.launch {
            host.currentSnackbarData?.dismiss()
            host.showSnackbar(message, duration = if (long) SnackbarDuration.Long else SnackbarDuration.Short)
        }
    }

    fun error(e: Throwable) = show(e.userMessage(), long = true)
}

fun Throwable.userMessage(): String = when (this) {
    is ApiException -> message ?: "Something went wrong."
    else -> "Something went wrong. Please try again."
}

/** Loading state for a screen's data. */
sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ok<T>(val data: T) : Load<T>
    data class Err(val error: ApiException) : Load<Nothing>
}

class LoadHandle<T>(private val state: MutableState<Load<T>>, private val bump: () -> Unit) {
    val value: Load<T> get() = state.value
    val data: T? get() = (state.value as? Load.Ok<T>)?.data
    var refreshing by mutableStateOf(false)
        internal set

    /** Re-fetch, keeping current data on screen while loading. */
    fun reload() {
        refreshing = true
        bump()
    }

    /** Replace data locally after a mutation (optimistic update). */
    fun set(value: T) {
        state.value = Load.Ok(value)
    }
}

/**
 * Fetches data when the screen opens (and whenever [key] changes or reload() is called).
 * Errors become an [ApiException] the UI can render with a retry button.
 */
@Composable
fun <T> rememberLoad(key: Any? = Unit, fetch: suspend () -> T): LoadHandle<T> {
    val state = remember(key) { mutableStateOf<Load<T>>(Load.Loading) }
    var version by remember(key) { mutableIntStateOf(0) }
    val handle = remember(key) { LoadHandle(state) { version++ } }
    LaunchedEffect(key, version) {
        try {
            state.value = Load.Ok(fetch())
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            if (state.value !is Load.Ok || version == 0) state.value = Load.Err(e)
        } catch (e: Exception) {
            if (state.value !is Load.Ok) state.value = Load.Err(ApiException(-1, "client_error", "Something went wrong. Please try again."))
        } finally {
            handle.refreshing = false
        }
    }
    return handle
}
