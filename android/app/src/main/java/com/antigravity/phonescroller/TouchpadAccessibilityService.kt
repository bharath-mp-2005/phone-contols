package com.antigravity.phonescroller

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent

class TouchpadAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "TouchpadA11yService"

        @Volatile
        var instance: TouchpadAccessibilityService? = null
            private set

        fun isRunning(): Boolean = instance != null
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var windowManager: WindowManager? = null
    private var cursorView: View? = null
    private var layoutParams: WindowManager.LayoutParams? = null

    private var cursorX = 0f
    private var cursorY = 0f

    private var dragStartX = 0f
    private var dragStartY = 0f

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "Accessibility service connected")

        mainHandler.post {
            val screenWidth = getScreenWidth()
            val screenHeight = getScreenHeight()
            cursorX = screenWidth / 2f
            cursorY = screenHeight / 2f
            if (TouchpadService.clientCount > 0) {
                setupCursorOverlay()
            }
        }
    }

    override fun onDestroy() {
        instance = null
        mainHandler.post {
            removeCursorOverlay()
        }
        Log.i(TAG, "Accessibility service destroyed")
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Not needed for gesture injection
    }

    override fun onInterrupt() {
        // Not needed for gesture injection
    }

    private fun setupCursorOverlay() {
        if (cursorView != null) return
        try {
            val density = resources.displayMetrics.density
            val size = (18 * density).toInt()

            cursorView = View(this).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(android.graphics.Color.parseColor("#9900E5FF")) // Premium translucent cyber-cyan
                    setStroke((2.5f * density).toInt(), android.graphics.Color.WHITE) // Premium white border outline
                }
            }

            windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            layoutParams = WindowManager.LayoutParams().apply {
                width = size
                height = size
                type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
                flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                format = android.graphics.PixelFormat.TRANSLUCENT
                gravity = Gravity.TOP or Gravity.LEFT
                x = (cursorX - size / 2).toInt()
                y = (cursorY - size / 2).toInt()
            }

            windowManager?.addView(cursorView, layoutParams)
            Log.i(TAG, "Cursor overlay added successfully at ($cursorX, $cursorY)")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to setup cursor overlay", e)
        }
    }

    private fun updateCursorOverlayPosition() {
        val view = cursorView ?: return
        val params = layoutParams ?: return
        val size = view.width
        params.x = (cursorX - size / 2).toInt()
        params.y = (cursorY - size / 2).toInt()
        try {
            windowManager?.updateViewLayout(view, params)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update cursor overlay position", e)
        }
    }

    private fun removeCursorOverlay() {
        val view = cursorView ?: return
        try {
            windowManager?.removeView(view)
            Log.i(TAG, "Cursor overlay removed successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to remove cursor overlay", e)
        } finally {
            cursorView = null
            windowManager = null
            layoutParams = null
        }
    }

    fun showCursor(show: Boolean) {
        mainHandler.post {
            if (show) {
                setupCursorOverlay()
            } else {
                removeCursorOverlay()
            }
        }
    }

    /**
     * Relative cursor movement. Called from WebSocket thread.
     */
    fun moveCursor(dx: Float, dy: Float) {
        mainHandler.post {
            cursorX = (cursorX + dx).coerceIn(0f, getScreenWidth().toFloat())
            cursorY = (cursorY + dy).coerceIn(0f, getScreenHeight().toFloat())
            updateCursorOverlayPosition()
        }
    }

    /**
     * Tap gesture at current cursor coordinates.
     */
    fun performClickAtCursor() {
        mainHandler.post {
            val path = Path().apply {
                moveTo(cursorX, cursorY)
                lineTo(cursorX, cursorY)
            }
            buildAndDispatchGesture(path, 50L)
            Log.d(TAG, "Cursor click at ($cursorX, $cursorY)")
        }
    }

    /**
     * Double tap gesture at current cursor coordinates.
     */
    fun performDoubleClickAtCursor() {
        mainHandler.post {
            val path = Path().apply {
                moveTo(cursorX, cursorY)
                lineTo(cursorX, cursorY)
            }
            try {
                val stroke1 = GestureDescription.StrokeDescription(path, 0, 50L)
                val stroke2 = GestureDescription.StrokeDescription(path, 150L, 50L)
                val gesture = GestureDescription.Builder()
                    .addStroke(stroke1)
                    .addStroke(stroke2)
                    .build()
                dispatchGesture(gesture, null, null)
                Log.d(TAG, "Cursor double-click at ($cursorX, $cursorY)")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to dispatch double click gesture", e)
            }
        }
    }

    /**
     * Initiates a drag sequence at current cursor position.
     */
    fun startDragAtCursor() {
        mainHandler.post {
            dragStartX = cursorX
            dragStartY = cursorY
            Log.d(TAG, "Drag sequence started at ($dragStartX, $dragStartY)")
        }
    }

    /**
     * Moves cursor relatively during a drag.
     */
    fun dragCursor(dx: Float, dy: Float) {
        moveCursor(dx, dy)
    }

    /**
     * Concludes the drag, dispatching a swipe gesture from start position to final cursor position.
     */
    fun endDragAtCursor() {
        mainHandler.post {
            val path = Path().apply {
                moveTo(dragStartX, dragStartY)
                lineTo(cursorX, cursorY)
            }
            buildAndDispatchGesture(path, 350L)
            Log.d(TAG, "Drag gesture dispatched from ($dragStartX, $dragStartY) to ($cursorX, $cursorY)")
        }
    }

    /**
     * Performs a tap at the given normalized coordinates (0.0 to 1.0).
     */
    fun performTap(x: Float, y: Float) {
        mainHandler.post {
            val screenWidth = getScreenWidth()
            val screenHeight = getScreenHeight()
 
            val pixelX = (x * screenWidth).coerceIn(0f, screenWidth.toFloat() - 1f)
            val pixelY = (y * screenHeight).coerceIn(0f, screenHeight.toFloat() - 1f)
 
            val path = Path().apply {
                moveTo(pixelX, pixelY)
                lineTo(pixelX, pixelY)
            }
 
            buildAndDispatchGesture(path, 50L)
            Log.d(TAG, "Tap at ($pixelX, $pixelY)")
        }
    }

    /**
     * Performs a scroll gesture using dx/dy as pixel offsets from the center of the screen.
     */
    fun performScroll(dx: Float, dy: Float) {
        mainHandler.post {
            val screenWidth = getScreenWidth()
            val screenHeight = getScreenHeight()
 
            val centerX = screenWidth / 2f
            val centerY = screenHeight / 2f
 
            val endX = (centerX - dx).coerceIn(0f, screenWidth.toFloat() - 1f)
            val endY = (centerY - dy).coerceIn(0f, screenHeight.toFloat() - 1f)
 
            val path = Path().apply {
                moveTo(centerX, centerY)
                lineTo(endX, endY)
            }
 
            buildAndDispatchGesture(path, 100L)
            Log.d(TAG, "Scroll from ($centerX, $centerY) to ($endX, $endY)")
        }
    }

    /**
     * Performs a swipe gesture using normalized coordinates (0.0 to 1.0).
     */
    fun performSwipe(startX: Float, startY: Float, endX: Float, endY: Float, duration: Long) {
        mainHandler.post {
            val screenWidth = getScreenWidth()
            val screenHeight = getScreenHeight()
 
            val pxStartX = (startX * screenWidth).coerceIn(0f, screenWidth.toFloat() - 1f)
            val pxStartY = (startY * screenHeight).coerceIn(0f, screenHeight.toFloat() - 1f)
            val pxEndX = (endX * screenWidth).coerceIn(0f, screenWidth.toFloat() - 1f)
            val pxEndY = (endY * screenHeight).coerceIn(0f, screenHeight.toFloat() - 1f)
 
            val gestureDuration = if (duration > 0) duration else 300L
 
            val path = Path().apply {
                moveTo(pxStartX, pxStartY)
                lineTo(pxEndX, pxEndY)
            }
 
            buildAndDispatchGesture(path, gestureDuration)
            Log.d(TAG, "Swipe from ($pxStartX, $pxStartY) to ($pxEndX, $pxEndY) duration=$gestureDuration")
        }
    }

    fun performScrollAtCursor(dx: Float, dy: Float) {
        mainHandler.post {
            val scrollScaleFactor = 6.0f
            val amplifiedDx = dx * scrollScaleFactor
            val amplifiedDy = dy * scrollScaleFactor
            
            val startX = cursorX
            val startY = cursorY
            val endX = (startX - amplifiedDx).coerceIn(0f, getScreenWidth().toFloat())
            val endY = (startY - amplifiedDy).coerceIn(0f, getScreenHeight().toFloat())
 
            val path = Path().apply {
                moveTo(startX, startY)
                lineTo(endX, endY)
            }
            buildAndDispatchGesture(path, 120L)
            Log.d(TAG, "Scroll at cursor from ($startX, $startY) to ($endX, $endY) [original dx=$dx, dy=$dy]")
        }
    }
 
    fun performBack() {
        val success = performGlobalAction(GLOBAL_ACTION_BACK)
        Log.d(TAG, "Back action executed, success=$success")
    }
 
    fun performHome() {
        val success = performGlobalAction(GLOBAL_ACTION_HOME)
        Log.d(TAG, "Home action executed, success=$success")
    }
 
    fun performRecents() {
        val success = performGlobalAction(GLOBAL_ACTION_RECENTS)
        Log.d(TAG, "Recents action executed, success=$success")
    }

    private fun buildAndDispatchGesture(path: Path, duration: Long) {
        mainHandler.post {
            try {
                val gesture = GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(path, 0, duration))
                    .build()
                dispatchGesture(gesture, object : GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) {
                        Log.v(TAG, "Gesture completed")
                    }
 
                    override fun onCancelled(gestureDescription: GestureDescription?) {
                        Log.w(TAG, "Gesture cancelled")
                    }
                }, null)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to dispatch gesture", e)
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun getScreenWidth(): Int {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        wm.defaultDisplay.getRealMetrics(metrics)
        return metrics.widthPixels
    }

    @Suppress("DEPRECATION")
    private fun getScreenHeight(): Int {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        wm.defaultDisplay.getRealMetrics(metrics)
        return metrics.heightPixels
    }
}
