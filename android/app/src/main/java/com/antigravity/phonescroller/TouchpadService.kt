package com.antigravity.phonescroller

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.gson.JsonParser
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress

class TouchpadService : Service() {

    companion object {
        private const val TAG = "TouchpadService"
        private const val CHANNEL_ID = "touchpad_service_channel"
        private const val NOTIFICATION_ID = 1
        const val EXTRA_PORT = "extra_port"
        const val DEFAULT_PORT = 8080

        const val ACTION_STATUS_UPDATE = "com.antigravity.phonescroller.STATUS_UPDATE"
        const val EXTRA_SERVER_RUNNING = "extra_server_running"
        const val EXTRA_CLIENT_COUNT = "extra_client_count"

        @Volatile
        var isRunning: Boolean = false
            private set

        @Volatile
        var clientCount: Int = 0
            private set
    }

    private var wsServer: TouchpadWebSocketServer? = null
    private val binder = LocalBinder()

    inner class LocalBinder : Binder() {
        fun getService(): TouchpadService = this@TouchpadService
    }

    override fun onBind(intent: Intent?): IBinder {
        return binder
    }

    inner class TouchpadWebSocketServer(port: Int) : WebSocketServer(InetSocketAddress(port)) {

        override fun onOpen(conn: WebSocket?, handshake: ClientHandshake?) {
            clientCount = connections.size
            Log.i(TAG, "Client connected: ${conn?.remoteSocketAddress} (total: $clientCount)")
            broadcastStatus()
            TouchpadAccessibilityService.instance?.showCursor(true)
        }

        override fun onClose(conn: WebSocket?, code: Int, reason: String?, remote: Boolean) {
            clientCount = connections.size - 1
            if (clientCount < 0) clientCount = 0
            Log.i(TAG, "Client disconnected: ${conn?.remoteSocketAddress} (total: $clientCount)")
            broadcastStatus()
            if (clientCount == 0) {
                TouchpadAccessibilityService.instance?.showCursor(false)
            }
        }

        override fun onMessage(conn: WebSocket?, message: String?) {
            message?.let { handleMessage(it) }
        }

        override fun onError(conn: WebSocket?, ex: Exception?) {
            Log.e(TAG, "WebSocket error: ${ex?.message}", ex)
        }

        override fun onStart() {
            Log.i(TAG, "WebSocket server started on port $port")
            isRunning = true
            broadcastStatus()
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        
        // Start foreground service immediately in onCreate to avoid timing-related 
        // "Context.startForegroundService() did not then call Service.startForeground()" crashes.
        val notification = createNotification(DEFAULT_PORT)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        Log.i(TAG, "Service created and promoted to foreground")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val port = intent?.getIntExtra(EXTRA_PORT, DEFAULT_PORT) ?: DEFAULT_PORT
 
        // If the port is different from the default port, update the active notification
        if (port != DEFAULT_PORT) {
            val notification = createNotification(port)
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.notify(NOTIFICATION_ID, notification)
        }
 
        if (wsServer == null) {
            try {
                wsServer = TouchpadWebSocketServer(port).also {
                    it.isReuseAddr = true
                    it.start()
                }
                Log.i(TAG, "Starting WebSocket server on port $port")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start WebSocket server", e)
                stopSelf()
            }
        }
 
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        try {
            wsServer?.stop(1000)
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping WebSocket server", e)
        }
        wsServer = null
        isRunning = false
        clientCount = 0
        broadcastStatus()
        TouchpadAccessibilityService.instance?.showCursor(false)
        Log.i(TAG, "Service destroyed")
        super.onDestroy()
    }

    private fun handleMessage(json: String) {
        try {
            val obj = JsonParser.parseString(json).asJsonObject
            val type = obj.get("type").asString
            val service = TouchpadAccessibilityService.instance

            when (type) {
                "move" -> {
                    val dx = obj.get("dx").asFloat
                    val dy = obj.get("dy").asFloat
                    service?.moveCursor(dx, dy)
                }
                "click" -> {
                    service?.performClickAtCursor()
                }
                "double_click" -> {
                    service?.performDoubleClickAtCursor()
                }
                "drag_start" -> {
                    service?.startDragAtCursor()
                }
                "drag" -> {
                    val dx = obj.get("dx").asFloat
                    val dy = obj.get("dy").asFloat
                    service?.dragCursor(dx, dy)
                }
                "drag_end" -> {
                    service?.endDragAtCursor()
                }
                "tap" -> {
                    val x = obj.get("x").asFloat
                    val y = obj.get("y").asFloat
                    service?.performTap(x, y)
                }
                "scroll" -> {
                    val dx = obj.get("dx").asFloat
                    val dy = obj.get("dy").asFloat
                    service?.performScrollAtCursor(dx, dy)
                }
                "swipe" -> {
                    val startX = obj.get("startX").asFloat
                    val startY = obj.get("startY").asFloat
                    val endX = obj.get("endX").asFloat
                    val endY = obj.get("endY").asFloat
                    val duration = obj.get("duration").asLong
                    service?.performSwipe(startX, startY, endX, endY, duration)
                }
                "back" -> {
                    Log.d(TAG, "Back action requested. Service running: ${service != null}")
                    if (service == null) Log.w(TAG, "TouchpadAccessibilityService instance is null! Is Accessibility Service toggled ON?")
                    service?.performBack()
                }
                "home" -> {
                    Log.d(TAG, "Home action requested. Service running: ${service != null}")
                    if (service == null) Log.w(TAG, "TouchpadAccessibilityService instance is null! Is Accessibility Service toggled ON?")
                    service?.performHome()
                }
                "recents" -> {
                    Log.d(TAG, "Recents action requested. Service running: ${service != null}")
                    if (service == null) Log.w(TAG, "TouchpadAccessibilityService instance is null! Is Accessibility Service toggled ON?")
                    service?.performRecents()
                }
                "lock" -> {
                    Log.d(TAG, "Lock action requested")
                    lockDevice()
                }
                else -> Log.w(TAG, "Unknown message type: $type")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error handling message: $json", e)
        }
    }
 
    private fun lockDevice() {
        try {
            val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val adminComponent = ComponentName(this, TouchpadAdminReceiver::class.java)
            if (dpm.isAdminActive(adminComponent)) {
                dpm.lockNow()
                Log.i(TAG, "Device locked")
            } else {
                Log.w(TAG, "Device admin not active, cannot lock")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to lock device", e)
        }
    }

    private fun broadcastStatus() {
        val intent = Intent(ACTION_STATUS_UPDATE).apply {
            putExtra(EXTRA_SERVER_RUNNING, isRunning)
            putExtra(EXTRA_CLIENT_COUNT, clientCount)
            setPackage(packageName)
        }
        sendBroadcast(intent)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_channel_description)
                setShowBadge(false)
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(port: Int): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text, port))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }
}
