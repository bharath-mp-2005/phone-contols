/* ============================================================
   Phone Scroller — Renderer Process
   Complete client-side logic: WebSocket, gestures, UI
   ============================================================ */

(function () {
  'use strict';

  // ── STATE ──────────────────────────────────────────────────
  const state = {
    ws: null,
    connected: false,
    reconnectTimer: null,
    reconnectAttempt: 0,
    maxReconnectAttempts: 50,
    settings: {
      ip: '',
      port: '8080',
      opacity: 100
    },
    gesture: {
      isDown: false,
      isDoubleTapScroll: false,
      startX: 0,
      startY: 0,
      lastX: undefined,
      lastY: undefined,
      startTime: 0,
      moved: false,
      pointerId: null
    },
    tapCount: 0,
    tapTimer: null,
    lastTapTime: 0,
    doubleTapWindow: 400,
    scrollSensitivity: 1.5,
    moveThreshold: 1.5,
    tapMaxDuration: 300,
    settingsOpen: false,
    intentionalDisconnect: false,
    wheelAccumulatorY: 0,
    wheelCooldown: false,
    wheelCooldownDuration: 100,
    scrollAccumulatorX: 0,
    scrollAccumulatorY: 0,
    scrollCooldown: false,
    scrollCooldownDuration: 100,
    clickDeferTimer: null
  };

  // ── DOM REFERENCES ─────────────────────────────────────────
  const dom = {};

  function cacheDom() {
    dom.settingsToggle = document.getElementById('settingsToggle');
    dom.minimizeBtn = document.getElementById('minimizeBtn');
    dom.settingsPanel = document.getElementById('settingsPanel');
    dom.connectionStatus = document.getElementById('connectionStatus');
    dom.connectionText = document.getElementById('connectionText');
    dom.ipInput = document.getElementById('ipInput');
    dom.portInput = document.getElementById('portInput');
    dom.opacitySlider = document.getElementById('opacitySlider');
    dom.opacityValue = document.getElementById('opacityValue');
    dom.connectBtn = document.getElementById('connectBtn');
    dom.touchpad = document.getElementById('touchpad');
    dom.btnHome = document.getElementById('btnHome');
    dom.btnClick = document.getElementById('btnClick');
    dom.btnBack = document.getElementById('btnBack');
    dom.btnRecents = document.getElementById('btnRecents');
    dom.btnLock = document.getElementById('btnLock');
    dom.btnScrollUp = document.getElementById('btnScrollUp');
    dom.btnScrollDown = document.getElementById('btnScrollDown');
  }

  // ── SETTINGS ───────────────────────────────────────────────
  function loadSettings() {
    try {
      const saved = localStorage.getItem('phoneScrollerSettings');
      if (saved) {
        const parsed = JSON.parse(saved);
        state.settings.ip = parsed.ip || '';
        state.settings.port = parsed.port || '8080';
        state.settings.opacity = parsed.opacity != null ? parsed.opacity : 100;
      }
    } catch (e) {
      console.warn('Failed to load settings:', e);
    }

    dom.ipInput.value = state.settings.ip;
    dom.portInput.value = state.settings.port;
    dom.opacitySlider.value = state.settings.opacity;
    updateOpacityLabel(state.settings.opacity);
    applyOpacity(state.settings.opacity);
  }

  function saveSettings() {
    state.settings.ip = dom.ipInput.value.trim();
    state.settings.port = dom.portInput.value.trim() || '8080';
    state.settings.opacity = parseInt(dom.opacitySlider.value, 10);

    try {
      localStorage.setItem('phoneScrollerSettings', JSON.stringify(state.settings));
    } catch (e) {
      console.warn('Failed to save settings:', e);
    }
  }

  function updateOpacityLabel(val) {
    dom.opacityValue.textContent = `${val}%`;
  }

  function applyOpacity(val) {
    const normalized = val / 100;
    if (window.electronAPI && window.electronAPI.setOpacity) {
      window.electronAPI.setOpacity(normalized);
    }
  }

  function toggleSettings() {
    state.settingsOpen = !state.settingsOpen;
    dom.settingsPanel.classList.toggle('open', state.settingsOpen);
    dom.settingsToggle.classList.toggle('active', state.settingsOpen);
  }

  // ── CONNECTION STATUS ──────────────────────────────────────
  function setStatus(status, text) {
    dom.connectionStatus.className = 'connection-status';

    if (status === 'connected') {
      dom.connectionStatus.classList.add('connection-status--connected');
      dom.connectionText.textContent = text || 'Connected';
      dom.connectBtn.textContent = 'Disconnect';
      dom.connectBtn.classList.add('settings-panel__connect-btn--disconnect');
    } else if (status === 'connecting') {
      dom.connectionStatus.classList.add('connection-status--connecting');
      dom.connectionText.textContent = text || 'Connecting…';
      dom.connectBtn.textContent = 'Connecting…';
      dom.connectBtn.classList.remove('settings-panel__connect-btn--disconnect');
    } else {
      dom.connectionText.textContent = text || 'Disconnected';
      dom.connectBtn.textContent = 'Connect';
      dom.connectBtn.classList.remove('settings-panel__connect-btn--disconnect');
    }
  }

  // ── WEBSOCKET ──────────────────────────────────────────────
  function connect() {
    const ip = dom.ipInput.value.trim();
    const port = dom.portInput.value.trim() || '8080';

    if (!ip) {
      setStatus('disconnected', 'Enter IP address');
      if (!state.settingsOpen) toggleSettings();
      dom.ipInput.focus();
      return;
    }

    saveSettings();
    state.intentionalDisconnect = false;

    if (state.ws) {
      try { state.ws.close(); } catch (_) { /* ignore */ }
    }

    setStatus('connecting');

    try {
      state.ws = new WebSocket(`ws://${ip}:${port}`);
    } catch (e) {
      console.error('WebSocket creation failed:', e);
      setStatus('disconnected', 'Connection failed');
      scheduleReconnect();
      return;
    }

    state.ws.onopen = () => {
      state.connected = true;
      state.reconnectAttempt = 0;
      setStatus('connected');
      console.log(`Connected to ws://${ip}:${port}`);
    };

    state.ws.onclose = (event) => {
      state.connected = false;
      state.ws = null;

      if (state.intentionalDisconnect) {
        setStatus('disconnected', 'Disconnected');
      } else {
        setStatus('disconnected', 'Connection lost');
        scheduleReconnect();
      }
    };

    state.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    state.ws.onmessage = (event) => {
      console.log('Server message:', event.data);
    };
  }

  function disconnect() {
    state.intentionalDisconnect = true;
    clearReconnectTimer();

    if (state.ws) {
      try { state.ws.close(); } catch (_) { /* ignore */ }
      state.ws = null;
    }

    state.connected = false;
    setStatus('disconnected', 'Disconnected');
  }

  function clearReconnectTimer() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    clearReconnectTimer();

    if (state.intentionalDisconnect) return;
    if (state.reconnectAttempt >= state.maxReconnectAttempts) {
      setStatus('disconnected', 'Reconnect failed');
      return;
    }

    state.reconnectAttempt++;
    const delay = Math.min(3000 * state.reconnectAttempt, 15000);

    setStatus('connecting', `Reconnecting (${state.reconnectAttempt})…`);

    state.reconnectTimer = setTimeout(() => {
      if (!state.intentionalDisconnect) {
        connect();
      }
    }, delay);
  }

  function send(data) {
    if (state.connected && state.ws && state.ws.readyState === WebSocket.OPEN) {
      try {
        state.ws.send(JSON.stringify(data));
      } catch (e) {
        console.error('Send failed:', e);
      }
    }
  }

  // ── RIPPLE & TRAIL EFFECTS ─────────────────────────────────
  function createRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.classList.add('ripple');

    const size = 80;
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${x - size / 2}px`;
    ripple.style.top = `${y - size / 2}px`;

    dom.touchpad.appendChild(ripple);

    ripple.addEventListener('animationend', () => {
      ripple.remove();
    }, { once: true });

    // Safety cleanup
    setTimeout(() => {
      if (ripple.parentNode) ripple.remove();
    }, 700);
  }

  function createTrailDot(x, y) {
    const dot = document.createElement('div');
    dot.classList.add('trail-dot');
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
 
    dom.touchpad.appendChild(dot);
 
    dot.addEventListener('animationend', () => {
      dot.remove();
    }, { once: true });
 
    // Safety cleanup
    setTimeout(() => {
      if (dot.parentNode) dot.remove();
    }, 500);
  }
 
  // ── TOUCHPAD GESTURES ──────────────────────────────────────
  let trailThrottle = 0;

  function onPointerEnter(e) {
    const rect = dom.touchpad.getBoundingClientRect();
    state.gesture.lastX = e.clientX - rect.left;
    state.gesture.lastY = e.clientY - rect.top;
  }

  function onPointerDown(e) {
    if (e.button !== 0) return; // left button only

    const rect = dom.touchpad.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    state.gesture.isDown = true;
    state.gesture.startX = x;
    state.gesture.startY = y;
    state.gesture.lastX = x;
    state.gesture.lastY = y;
    state.gesture.startTime = Date.now();
    state.gesture.moved = false;
    state.gesture.pointerId = e.pointerId;

    dom.touchpad.setPointerCapture(e.pointerId);

    // Cancel any deferred click since we got another down event
    if (state.clickDeferTimer) {
      clearTimeout(state.clickDeferTimer);
      state.clickDeferTimer = null;
    }

    if (state.tapTimer) {
      clearTimeout(state.tapTimer);
      state.tapTimer = null;
    }

    const now = Date.now();
    if (now - state.lastTapTime < state.doubleTapWindow) {
      state.tapCount++;
    } else {
      state.tapCount = 1;
    }
    state.lastTapTime = now;

    console.log(`PointerDown: tapCount = ${state.tapCount}`);
    e.preventDefault();
  }

  function onPointerMove(e) {
    const rect = dom.touchpad.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (state.gesture.lastX === undefined || state.gesture.lastY === undefined) {
      state.gesture.lastX = x;
      state.gesture.lastY = y;
      return;
    }

    const dx = x - state.gesture.lastX;
    const dy = y - state.gesture.lastY;
    const magnitude = Math.sqrt(dx * dx + dy * dy);

    if (magnitude > state.moveThreshold) {
      if (state.gesture.isDown) {
        if (state.tapCount === 1) {
          state.gesture.moved = true;
        } else if (state.tapCount === 2) {
          // Double-tap and move -> cursor move!
          send({
            type: 'move',
            dx: Math.round(dx * state.scrollSensitivity),
            dy: Math.round(dy * state.scrollSensitivity)
          });
          state.gesture.moved = true;
        } else if (state.tapCount === 3) {
          // Triple-tap and move -> scroll with accumulator and cooldown
          state.scrollAccumulatorX += dx;
          state.scrollAccumulatorY += dy;

          if (!state.scrollCooldown) {
            const threshold = 15; // lower threshold for responsive scrolling
            if (Math.abs(state.scrollAccumulatorX) >= threshold || Math.abs(state.scrollAccumulatorY) >= threshold) {
              send({
                type: 'scroll',
                dx: Math.round(state.scrollAccumulatorX * state.scrollSensitivity),
                dy: Math.round(state.scrollAccumulatorY * state.scrollSensitivity)
              });
              state.scrollAccumulatorX = 0;
              state.scrollAccumulatorY = 0;
              state.scrollCooldown = true;
              setTimeout(() => {
                state.scrollCooldown = false;
              }, state.scrollCooldownDuration);
            }
          }
          state.gesture.moved = true;
        }
      }

      state.gesture.lastX = x;
      state.gesture.lastY = y;

      // Throttled trail dot visual feedback
      if (state.gesture.isDown) {
        trailThrottle++;
        if (trailThrottle % 3 === 0) {
          createTrailDot(x, y);
        }
      }
    }

    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!state.gesture.isDown) return;

    const rect = dom.touchpad.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (state.gesture.pointerId != null) {
      try {
        dom.touchpad.releasePointerCapture(state.gesture.pointerId);
      } catch (_) { /* ignore */ }
    }

    // Cancel any existing click defer timer
    if (state.clickDeferTimer) {
      clearTimeout(state.clickDeferTimer);
      state.clickDeferTimer = null;
    }

    if (!state.gesture.moved) {
      // Defer tap action to allow detecting double/triple tap
      const tx = x;
      const ty = y;
      const twidth = rect.width;
      const theight = rect.height;
      const currentTapCount = state.tapCount;

      state.clickDeferTimer = setTimeout(() => {
        const normalizedX = tx / twidth;
        const normalizedY = ty / theight;

        if (currentTapCount === 1) {
          send({
            type: 'tap',
            x: normalizedX,
            y: normalizedY
          });
          createRipple(tx, ty);
        } else if (currentTapCount === 2) {
          // Double click -> two taps
          send({ type: 'tap', x: normalizedX, y: normalizedY });
          send({ type: 'tap', x: normalizedX, y: normalizedY });
          createRipple(tx, ty);
        } else if (currentTapCount === 3) {
          // Triple click -> three taps
          send({ type: 'tap', x: normalizedX, y: normalizedY });
          send({ type: 'tap', x: normalizedX, y: normalizedY });
          send({ type: 'tap', x: normalizedX, y: normalizedY });
          createRipple(tx, ty);
        }
        state.clickDeferTimer = null;
      }, 220); // 220ms window to detect subsequent taps
    } else {
      // Gesture moved
      if (state.tapCount === 1) {
        // Single drag -> swipe
        const duration = Date.now() - state.gesture.startTime;
        send({
          type: 'swipe',
          startX: state.gesture.startX / rect.width,
          startY: state.gesture.startY / rect.height,
          endX: x / rect.width,
          endY: y / rect.height,
          duration: Math.max(duration, 50)
        });
      } else if (state.tapCount === 2 || state.tapCount === 3) {
        createRipple(x, y);
      }

      // Reset tapCount immediately after drag/scroll/swipe gestures complete
      state.tapCount = 0;
      if (state.tapTimer) {
        clearTimeout(state.tapTimer);
        state.tapTimer = null;
      }
    }

    // Schedule a timer to reset tapCount to 0 after doubleTapWindow
    state.tapTimer = setTimeout(() => {
      state.tapCount = 0;
      state.tapTimer = null;
    }, state.doubleTapWindow);

    // Reset gesture state
    state.gesture.isDown = false;
    state.gesture.moved = false;
    state.gesture.pointerId = null;
    state.gesture.lastX = undefined;
    state.gesture.lastY = undefined;
    trailThrottle = 0;

    e.preventDefault();
  }

  function onPointerLeave(e) {
    if (state.gesture.isDown) {
      onPointerUp(e);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    if (!state.connected) return;

    state.wheelAccumulatorY += e.deltaY;

    if (state.wheelCooldown) return;

    const threshold = 30;
    if (Math.abs(state.wheelAccumulatorY) >= threshold) {
      const dy = state.wheelAccumulatorY * state.scrollSensitivity;

      send({
        type: 'scroll',
        dx: 0,
        dy: Math.round(dy)
      });

      state.wheelAccumulatorY = 0;
      state.wheelCooldown = true;
      setTimeout(() => {
        state.wheelCooldown = false;
      }, state.wheelCooldownDuration);
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
    send({ type: 'home' });
    createRipple(
      e.clientX - dom.touchpad.getBoundingClientRect().left,
      e.clientY - dom.touchpad.getBoundingClientRect().top
    );
  }

  // ── ACTION BUTTONS ─────────────────────────────────────────
  function setupActionButtons() {
    console.log("Setting up action buttons click listeners...");
    
    dom.btnClick.addEventListener('click', () => {
      console.log("Click button clicked on UI");
      send({ type: 'click' });
    });
 
    dom.btnHome.addEventListener('click', () => {
      console.log("Home button clicked on UI");
      send({ type: 'home' });
    });
 
    dom.btnBack.addEventListener('click', () => {
      console.log("Back button clicked on UI");
      send({ type: 'back' });
    });
 
    dom.btnRecents.addEventListener('click', () => {
      console.log("Recents button clicked on UI");
      send({ type: 'recents' });
    });
 
    dom.btnLock.addEventListener('click', () => {
      console.log("Lock button clicked on UI");
      send({ type: 'lock' });
    });
 
    dom.btnScrollUp.addEventListener('click', () => {
      console.log("Scroll Up button clicked on UI");
      // Swipe down to scroll up
      send({
        type: 'swipe',
        startX: 0.5,
        startY: 0.2,
        endX: 0.5,
        endY: 0.8,
        duration: 400
      });
    });
 
    dom.btnScrollDown.addEventListener('click', () => {
      console.log("Scroll Down button clicked on UI");
      // Swipe up to scroll down
      send({
        type: 'swipe',
        startX: 0.5,
        startY: 0.8,
        endX: 0.5,
        endY: 0.2,
        duration: 400
      });
    });
  }

  // ── EVENT LISTENERS ────────────────────────────────────────
  function setupEventListeners() {
    // Minimize button
    dom.minimizeBtn.addEventListener('click', () => {
      if (window.electronAPI && window.electronAPI.minimizeWindow) {
        window.electronAPI.minimizeWindow();
      }
    });
 
    // Settings toggle
    dom.settingsToggle.addEventListener('click', toggleSettings);
 
    // Settings inputs — auto-save on change
    dom.ipInput.addEventListener('input', saveSettings);
    dom.portInput.addEventListener('input', saveSettings);
 
    // Opacity slider
    dom.opacitySlider.addEventListener('input', () => {
      const val = parseInt(dom.opacitySlider.value, 10);
      updateOpacityLabel(val);
      applyOpacity(val);
      saveSettings();
    });
 
    // Connect / Disconnect button
    dom.connectBtn.addEventListener('click', () => {
      if (state.connected) {
        disconnect();
      } else {
        connect();
      }
    });
 
    // Touchpad gesture events
    dom.touchpad.addEventListener('pointerdown', onPointerDown);
    dom.touchpad.addEventListener('pointermove', onPointerMove);
    dom.touchpad.addEventListener('pointerup', onPointerUp);
    dom.touchpad.addEventListener('pointerleave', onPointerLeave);
    dom.touchpad.addEventListener('pointerenter', onPointerEnter);
    dom.touchpad.addEventListener('wheel', onWheel);
    dom.touchpad.addEventListener('contextmenu', onContextMenu);
 
    // Action buttons
    setupActionButtons();
 
    // Keyboard shortcut — Escape to close settings
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.settingsOpen) {
        toggleSettings();
      }
    });
  }

  // ── INITIALIZATION ─────────────────────────────────────────
  function init() {
    cacheDom();
    loadSettings();
    setupEventListeners();

    // Auto-connect if IP is already set
    if (state.settings.ip) {
      setTimeout(() => connect(), 500);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
