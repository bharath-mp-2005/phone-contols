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
    clickDeferTimer: null,
    camera: {
      active: false,
      stream: null,
      handsInstance: null,
      cameraInstance: null,
      centroidHistory: [],
      palmHistory: [],
      cooldown: false,
      cooldownTimer: null
    }
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

    // Camera Gesture controls DOM
    dom.cameraToggle = document.getElementById('cameraToggle');
    dom.cameraPanel = document.getElementById('cameraPanel');
    dom.cameraVideo = document.getElementById('cameraVideo');
    dom.cameraCanvas = document.getElementById('cameraCanvas');
    dom.cameraGestureAlert = document.getElementById('cameraGestureAlert');
    dom.cameraStatus = document.getElementById('cameraStatus');
    dom.btnDisableCamera = document.getElementById('btnDisableCamera');
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

  // ── AIR GESTURE CONTROL (MEDIAPIPE) ─────────────────────────
  async function startCamera() {
    if (state.camera.active) return;
    
    dom.cameraStatus.textContent = 'Initializing AI Hands…';
    dom.cameraStatus.className = 'camera-panel__status';
    dom.cameraPanel.classList.add('open');
    dom.cameraToggle.classList.add('active');
    
    try {
      // 1. Initialize MediaPipe Hands
      const hands = new Hands({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });
      
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65
      });
      
      hands.onResults(onHandResults);
      state.camera.handsInstance = hands;
      
      // 2. Request camera stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, frameRate: 25 }
      });
      
      state.camera.stream = stream;
      dom.cameraVideo.srcObject = stream;
      
      dom.cameraVideo.onloadedmetadata = () => {
        dom.cameraVideo.play();
        state.camera.active = true;
        dom.cameraStatus.textContent = 'AI active — wave hand';
        dom.cameraStatus.classList.add('camera-panel__status--active');
        
        // 3. Setup MediaPipe Camera helper
        const cameraInstance = new Camera(dom.cameraVideo, {
          onFrame: async () => {
            if (state.camera.active && state.camera.handsInstance) {
              await state.camera.handsInstance.send({ image: dom.cameraVideo });
            }
          },
          width: 320,
          height: 240
        });
        cameraInstance.start();
        state.camera.cameraInstance = cameraInstance;
      };
    } catch (err) {
      console.error('Camera or AI initialization failed:', err);
      dom.cameraStatus.textContent = 'Permission denied or load failed';
      dom.cameraStatus.className = 'camera-panel__status';
      dom.cameraToggle.classList.remove('active');
      setTimeout(() => {
        if (!state.camera.active) {
          dom.cameraPanel.classList.remove('open');
        }
      }, 3000);
      stopCamera();
    }
  }

  function stopCamera() {
    if (!state.camera.active && !state.camera.handsInstance && !state.camera.stream) return;
    
    state.camera.active = false;
    
    if (state.camera.cameraInstance) {
      try {
        state.camera.cameraInstance.stop();
      } catch (e) {}
      state.camera.cameraInstance = null;
    }
    
    if (state.camera.handsInstance) {
      try {
        state.camera.handsInstance.close();
      } catch (e) {}
      state.camera.handsInstance = null;
    }
    
    if (state.camera.stream) {
      state.camera.stream.getTracks().forEach(track => track.stop());
      state.camera.stream = null;
    }
    
    dom.cameraVideo.srcObject = null;
    state.camera.centroidHistory = [];
    state.camera.palmHistory = [];
    
    if (state.camera.cooldownTimer) {
      clearTimeout(state.camera.cooldownTimer);
      state.camera.cooldownTimer = null;
    }
    state.camera.cooldown = false;
    
    dom.cameraPanel.classList.remove('open');
    dom.cameraToggle.classList.remove('active');
    dom.cameraStatus.textContent = 'Webcam off';
    dom.cameraStatus.className = 'camera-panel__status';
    
    const canvas = dom.cameraCanvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawHandSkeleton(ctx, landmarks, width, height) {
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20],
      [0, 17]
    ];
    
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    
    for (const [s, e] of connections) {
      const startLm = landmarks[s];
      const endLm = landmarks[e];
      if (startLm && endLm) {
        ctx.beginPath();
        ctx.moveTo(startLm.x * width, startLm.y * height);
        ctx.lineTo(endLm.x * width, endLm.y * height);
        ctx.stroke();
      }
    }
    
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      ctx.beginPath();
      ctx.arc(lm.x * width, lm.y * height, 3.5, 0, 2 * Math.PI);
      
      if ([4, 8, 12, 16, 20].includes(i)) {
        ctx.fillStyle = '#00e5ff';
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#00e5ff';
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 0;
      }
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function onHandResults(results) {
    const canvas = dom.cameraCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      state.camera.centroidHistory = [];
      state.camera.palmHistory = [];
      return;
    }
    
    const landmarks = results.multiHandLandmarks[0];
    
    drawHandSkeleton(ctx, landmarks, width, height);
    
    if (state.camera.cooldown) {
      return;
    }
    
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const indexPip = landmarks[6];
    const middleTip = landmarks[12];
    const middlePip = landmarks[10];
    const ringTip = landmarks[16];
    const ringPip = landmarks[14];
    const pinkyTip = landmarks[20];
    const pinkyPip = landmarks[18];
    const palmCenter = landmarks[9];
    
    // Check extended states of all fingers (y decreases when finger goes up)
    const isIndexExtended = indexTip.y < indexPip.y;
    const isMiddleExtended = middleTip.y < middlePip.y;
    const isRingExtended = ringTip.y < ringPip.y;
    const isPinkyExtended = pinkyTip.y < pinkyPip.y;
    
    // Classify Poses
    // Pointing Pose: Index extended, Middle, Ring, Pinky folded (closed)
    const isPointingPose = isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended;
    
    // Open Hand Pose: Index, Middle, Ring, Pinky all extended
    const isOpenHandPose = isIndexExtended && isMiddleExtended && isRingExtended && isPinkyExtended;
    
    // 1. Click Gesture: Pinch with thumb and index fingers together (no proximity)
    // Only check for pinch click if index finger is not extended straight (prevents collision with swipe down)
    const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
    if (!isIndexExtended && pinchDist < 0.038) {
      triggerGesture('click');
      return;
    }
    
    // 2. Scroll Up/Down Gesture: Index vertical swipe (pointing pose only)
    if (isPointingPose) {
      state.camera.centroidHistory.push({
        x: indexTip.x,
        y: indexTip.y,
        time: Date.now()
      });
      
      if (state.camera.centroidHistory.length > 10) {
        state.camera.centroidHistory.shift();
      }
      
      if (state.camera.centroidHistory.length >= 4) {
        const history = state.camera.centroidHistory;
        const start = history[0];
        const end = history[history.length - 1];
        const duration = end.time - start.time;
        
        if (duration >= 100 && duration <= 600) {
          const dy = end.y - start.y;
          const dx = end.x - start.x;
          const swipeThreshY = 0.12;
          
          if (Math.abs(dy) > swipeThreshY && Math.abs(dy) > Math.abs(dx)) {
            if (dy < 0) {
              triggerGesture('scroll-down');
            } else {
              triggerGesture('scroll-up');
            }
          }
        }
      }
    } else {
      // Clear scroll history if pose transitions to avoid carry-over triggers
      state.camera.centroidHistory = [];
    }
    
    // 3. Lock Gesture: Palm horizontal wave (open hand pose only)
    if (isOpenHandPose) {
      state.camera.palmHistory = state.camera.palmHistory || [];
      state.camera.palmHistory.push({
        x: palmCenter.x,
        y: palmCenter.y,
        time: Date.now()
      });
      
      if (state.camera.palmHistory.length > 10) {
        state.camera.palmHistory.shift();
      }
      
      if (state.camera.palmHistory.length >= 4) {
        const palmHistory = state.camera.palmHistory;
        const start = palmHistory[0];
        const end = palmHistory[palmHistory.length - 1];
        const duration = end.time - start.time;
        
        if (duration >= 100 && duration <= 600) {
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const swipeThreshX = 0.15;
          
          if (Math.abs(dx) > swipeThreshX && Math.abs(dx) > Math.abs(dy)) {
            triggerGesture('lock');
          }
        }
      }
    } else {
      // Clear lock history if pose transitions to avoid carry-over triggers
      state.camera.palmHistory = [];
    }
  }

  function triggerGesture(type) {
    if (state.camera.cooldown) return;
    
    state.camera.cooldown = true;
    state.camera.centroidHistory = [];
    state.camera.palmHistory = [];
    
    dom.cameraStatus.textContent = 'RESTING - hold position';
    dom.cameraStatus.classList.remove('camera-panel__status--active');
    dom.cameraStatus.style.color = '#ffab00';
    
    state.camera.cooldownTimer = setTimeout(() => {
      state.camera.cooldown = false;
      if (state.camera.active) {
        dom.cameraStatus.textContent = 'Camera active — wave hand';
        dom.cameraStatus.classList.add('camera-panel__status--active');
        dom.cameraStatus.style.color = '';
      }
    }, 1500);
    
    showGestureAlert(type);
    
    if (!state.connected) {
      console.warn('Gesture detected but not connected:', type);
      return;
    }
    
    console.log('AI Air Gesture Triggered:', type);
    
    if (type === 'scroll-up') {
      send({
        type: 'swipe',
        startX: 0.5,
        startY: 0.25,
        endX: 0.5,
        endY: 0.75,
        duration: 350
      });
    } else if (type === 'scroll-down') {
      send({
        type: 'swipe',
        startX: 0.5,
        startY: 0.75,
        endX: 0.5,
        endY: 0.25,
        duration: 350
      });
    } else if (type === 'click') {
      send({ type: 'click' });
    } else if (type === 'lock') {
      send({ type: 'lock' });
    }
  }

  function showGestureAlert(type) {
    const alertEl = dom.cameraGestureAlert;
    alertEl.className = 'camera-panel__gesture-alert';
    
    let text = '';
    if (type === 'scroll-up') {
      alertEl.classList.add('scroll-up');
      text = '▲ Scroll Up';
    } else if (type === 'scroll-down') {
      alertEl.classList.add('scroll-down');
      text = '▼ Scroll Down';
    } else if (type === 'click') {
      alertEl.classList.add('click');
      text = '● Click';
    } else if (type === 'lock') {
      alertEl.classList.add('lock');
      text = '🔒 Lock Phone';
    }
    
    alertEl.textContent = text;
    alertEl.classList.add('active');
    
    dom.cameraStatus.textContent = `${text} Triggered!`;
    dom.cameraStatus.style.color = '#00e5ff';
    
    setTimeout(() => {
      alertEl.classList.remove('active');
      if (state.camera.active && !state.camera.cooldown) {
        dom.cameraStatus.textContent = 'Camera active — wave hand';
        dom.cameraStatus.style.color = '';
      } else if (state.camera.active && state.camera.cooldown) {
        dom.cameraStatus.textContent = 'RESTING - hold position';
        dom.cameraStatus.style.color = '#ffab00';
      }
    }, 1000);
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
 
    // Camera toggle title bar button
    dom.cameraToggle.addEventListener('click', () => {
      if (state.camera.active) {
        stopCamera();
      } else {
        startCamera();
      }
    });

    // Camera close button inside panel
    dom.btnDisableCamera.addEventListener('click', stopCamera);

    // Stop camera stream on window unload
    window.addEventListener('beforeunload', stopCamera);

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
