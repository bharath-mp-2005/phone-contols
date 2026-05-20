package com.antigravity.phonescroller

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast

class TouchpadAdminReceiver : DeviceAdminReceiver() {

    companion object {
        private const val TAG = "TouchpadAdminReceiver"
    }

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i(TAG, "Device admin enabled")
        Toast.makeText(context, "Phone Scroller: Device admin enabled", Toast.LENGTH_SHORT).show()
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.i(TAG, "Device admin disabled")
        Toast.makeText(context, "Phone Scroller: Device admin disabled", Toast.LENGTH_SHORT).show()
    }
}
