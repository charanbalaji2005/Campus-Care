package edu.srmap.campuscare.data

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

data class RealtimeEvent(val name: String, val payload: JSONObject)

/**
 * Socket.IO connection to the API. Each connection is authenticated with a single-use,
 * 60-second ticket (never the session token), and every room subscription is authorised again
 * by the server. Because tickets are single-use, reconnects create a fresh socket with a new ticket.
 */
class Realtime(private val api: Api, private val config: ConfigRepository) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var socket: Socket? = null
    private val rooms = mutableSetOf<String>()
    @Volatile private var active = false
    private var retryJob: Job? = null
    private var backoffMs = 2_000L

    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<RealtimeEvent> = _events.asSharedFlow()

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    private val eventNames = listOf(
        "notification", "sos:new", "sos:updated", "case:updated", "case:message", "chat:message",
        "location:update", "campus_alert", "appointment:updated",
    )

    fun connect() {
        if (active) return
        active = true
        openSocket()
    }

    private fun openSocket() {
        scope.launch {
            if (!active) return@launch
            val ticket = runCatching { api.auth.realtimeTicket() }.getOrNull()
            if (ticket == null) {
                scheduleRetry()
                return@launch
            }
            val base = config.config.value.realtimeUrl?.takeIf { it.isNotBlank() } ?: ticket.url.ifBlank { api.client.baseUrl }
            val opts = IO.Options().apply {
                path = ticket.path
                transports = arrayOf("websocket")
                reconnection = false
                auth = mapOf("ticket" to ticket.ticket)
            }
            val s = runCatching { IO.socket(base, opts) }.getOrElse {
                Log.w("Realtime", "socket init failed", it)
                scheduleRetry()
                return@launch
            }
            s.on(Socket.EVENT_CONNECT) {
                _connected.value = true
                backoffMs = 2_000L
                synchronized(rooms) { rooms.toList() }.forEach { room -> emitSubscribe(s, room) }
            }
            s.on(Socket.EVENT_DISCONNECT) {
                _connected.value = false
                scheduleRetry()
            }
            s.on(Socket.EVENT_CONNECT_ERROR) {
                _connected.value = false
                scheduleRetry()
            }
            eventNames.forEach { name ->
                s.on(name) { args ->
                    val payload = args.firstOrNull() as? JSONObject ?: JSONObject()
                    _events.tryEmit(RealtimeEvent(name, payload))
                }
            }
            socket = s
            s.connect()
        }
    }

    private fun scheduleRetry() {
        if (!active || retryJob?.isActive == true) return
        retryJob = scope.launch {
            socket?.off()
            socket?.close()
            socket = null
            delay(backoffMs)
            backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
            openSocket()
        }
    }

    fun subscribe(room: String) {
        synchronized(rooms) { rooms.add(room) }
        socket?.let { if (it.connected()) emitSubscribe(it, room) }
    }

    fun unsubscribe(room: String) {
        synchronized(rooms) { rooms.remove(room) }
        socket?.emit("unsubscribe", JSONObject().put("room", room))
    }

    private fun emitSubscribe(s: Socket, room: String) {
        s.emit("subscribe", JSONObject().put("room", room))
    }

    fun disconnect() {
        active = false
        retryJob?.cancel()
        socket?.off()
        socket?.close()
        socket = null
        _connected.value = false
        synchronized(rooms) { rooms.clear() }
    }
}
