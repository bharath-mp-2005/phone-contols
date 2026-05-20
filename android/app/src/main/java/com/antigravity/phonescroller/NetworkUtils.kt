package com.antigravity.phonescroller

import android.content.Context
import android.net.wifi.WifiManager
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections

object NetworkUtils {

    fun getLocalIpAddress(context: Context): String {
        // Try WifiManager first
        try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val connectionInfo = wifiManager.connectionInfo
            val ipInt = connectionInfo.ipAddress
            if (ipInt != 0) {
                val ipAddress = String.format(
                    "%d.%d.%d.%d",
                    ipInt and 0xff,
                    ipInt shr 8 and 0xff,
                    ipInt shr 16 and 0xff,
                    ipInt shr 24 and 0xff
                )
                if (ipAddress != "0.0.0.0") {
                    return ipAddress
                }
            }
        } catch (_: Exception) {
            // Fall through to NetworkInterface enumeration
        }

        // Fall back to NetworkInterface enumeration (covers hotspot, ethernet, etc.)
        try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            for (networkInterface in interfaces) {
                if (networkInterface.isLoopback || !networkInterface.isUp) continue

                val addresses = Collections.list(networkInterface.inetAddresses)
                for (address in addresses) {
                    if (address.isLoopbackAddress) continue
                    if (address is Inet4Address) {
                        val hostAddress = address.hostAddress
                        if (hostAddress != null && hostAddress != "0.0.0.0") {
                            return hostAddress
                        }
                    }
                }
            }
        } catch (_: Exception) {
            // Fall through to return N/A
        }

        return "N/A"
    }
}
