package com.antigravity.phonescroller

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.antigravity.phonescroller.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val handler = Handler(Looper.getMainLooper())
    private var serverRunning = false

    private val statusUpdateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == TouchpadService.ACTION_STATUS_UPDATE) {
                val running = intent.getBooleanExtra(TouchpadService.EXTRA_SERVER_RUNNING, false)
                val clients = intent.getIntExtra(TouchpadService.EXTRA_CLIENT_COUNT, 0)
                updateServerStatusUI(running, clients)
            }
        }
    }

    private val statusRefreshRunnable = object : Runnable {
        override fun run() {
            refreshPermissionStatuses()
            handler.postDelayed(this, 3000)
        }
    }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                Toast.makeText(this, "Notification permission granted", Toast.LENGTH_SHORT).show()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        requestNotificationPermissionIfNeeded()
        setupUI()
        refreshIpAddress()
        refreshPermissionStatuses()
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter(TouchpadService.ACTION_STATUS_UPDATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(statusUpdateReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(statusUpdateReceiver, filter)
        }
        handler.post(statusRefreshRunnable)
        refreshPermissionStatuses()
        updateServerStatusUI(TouchpadService.isRunning, TouchpadService.clientCount)
    }

    override fun onPause() {
        super.onPause()
        try {
            unregisterReceiver(statusUpdateReceiver)
        } catch (_: IllegalArgumentException) {
            // Receiver not registered
        }
        handler.removeCallbacks(statusRefreshRunnable)
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    android.Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun setupUI() {
        // Refresh IP button
        binding.btnRefreshIp.setOnClickListener {
            refreshIpAddress()
        }

        // Server toggle button
        binding.btnToggleServer.setOnClickListener {
            if (serverRunning) {
                stopServer()
            } else {
                startServer()
            }
        }

        // Accessibility service button
        binding.btnAccessibility.setOnClickListener {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            startActivity(intent)
        }

        // Device admin button
        binding.btnDeviceAdmin.setOnClickListener {
            if (isDeviceAdminActive()) {
                Toast.makeText(this, "Device Admin is already enabled", Toast.LENGTH_SHORT).show()
            } else {
                val adminComponent = ComponentName(this, TouchpadAdminReceiver::class.java)
                val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
                    putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent)
                    putExtra(
                        DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                        getString(R.string.device_admin_description)
                    )
                }
                startActivity(intent)
            }
        }
    }

    private fun refreshIpAddress() {
        val ip = NetworkUtils.getLocalIpAddress(this)
        binding.tvIpAddress.text = ip
    }

    private fun startServer() {
        if (!isAccessibilityServiceEnabled()) {
            Toast.makeText(
                this,
                "Please enable the Accessibility Service first",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        val portText = binding.etPort.text?.toString()?.trim()
        val port = portText?.toIntOrNull()
        if (port == null || port < 1 || port > 65535) {
            binding.tilPort.error = "Enter a valid port (1-65535)"
            return
        }
        binding.tilPort.error = null

        val intent = Intent(this, TouchpadService::class.java).apply {
            putExtra(TouchpadService.EXTRA_PORT, port)
        }
        ContextCompat.startForegroundService(this, intent)

        serverRunning = true
        updateToggleButton()
    }

    private fun stopServer() {
        val intent = Intent(this, TouchpadService::class.java)
        stopService(intent)

        serverRunning = false
        updateServerStatusUI(false, 0)
    }

    private fun updateToggleButton() {
        if (serverRunning) {
            binding.btnToggleServer.text = getString(R.string.stop_server)
            binding.btnToggleServer.setBackgroundColor(
                ContextCompat.getColor(this, R.color.statusRed)
            )
        } else {
            binding.btnToggleServer.text = getString(R.string.start_server)
            binding.btnToggleServer.setBackgroundColor(
                ContextCompat.getColor(this, R.color.colorPrimary)
            )
        }
    }

    private fun updateServerStatusUI(running: Boolean, clients: Int) {
        serverRunning = running
        updateToggleButton()

        if (running) {
            binding.tvServerStatus.text = getString(R.string.status_running)
            binding.viewStatusIndicator.setBackgroundColor(
                ContextCompat.getColor(this, R.color.statusGreen)
            )
        } else {
            binding.tvServerStatus.text = getString(R.string.status_stopped)
            binding.viewStatusIndicator.setBackgroundColor(
                ContextCompat.getColor(this, R.color.statusRed)
            )
        }

        binding.tvClientCount.text = getString(R.string.clients_connected, clients)

        // Disable port editing while server is running
        binding.etPort.isEnabled = !running
    }

    private fun refreshPermissionStatuses() {
        // Accessibility service status
        val accessibilityEnabled = isAccessibilityServiceEnabled()
        if (accessibilityEnabled) {
            binding.tvAccessibilityStatus.text = getString(R.string.accessibility_enabled)
            binding.tvAccessibilityIcon.text = "✓"
            binding.tvAccessibilityIcon.setTextColor(
                ContextCompat.getColor(this, R.color.statusGreen)
            )
            binding.btnAccessibility.text = "Enabled"
        } else {
            binding.tvAccessibilityStatus.text = getString(R.string.accessibility_disabled)
            binding.tvAccessibilityIcon.text = "✗"
            binding.tvAccessibilityIcon.setTextColor(
                ContextCompat.getColor(this, R.color.statusRed)
            )
            binding.btnAccessibility.text = "Enable"
        }

        // Device admin status
        val adminEnabled = isDeviceAdminActive()
        if (adminEnabled) {
            binding.tvDeviceAdminStatus.text = getString(R.string.device_admin_enabled)
            binding.tvDeviceAdminIcon.text = "✓"
            binding.tvDeviceAdminIcon.setTextColor(
                ContextCompat.getColor(this, R.color.statusGreen)
            )
            binding.btnDeviceAdmin.text = "Enabled"
        } else {
            binding.tvDeviceAdminStatus.text = getString(R.string.device_admin_disabled)
            binding.tvDeviceAdminIcon.text = "✗"
            binding.tvDeviceAdminIcon.setTextColor(
                ContextCompat.getColor(this, R.color.statusRed)
            )
            binding.btnDeviceAdmin.text = "Enable"
        }
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val serviceId = "$packageName/${TouchpadAccessibilityService::class.java.canonicalName}"
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        val colonSplitter = TextUtils.SimpleStringSplitter(':')
        colonSplitter.setString(enabledServices)
        while (colonSplitter.hasNext()) {
            val componentName = colonSplitter.next()
            if (componentName.equals(serviceId, ignoreCase = true)) {
                return true
            }
        }
        return false
    }

    private fun isDeviceAdminActive(): Boolean {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminComponent = ComponentName(this, TouchpadAdminReceiver::class.java)
        return dpm.isAdminActive(adminComponent)
    }
}
