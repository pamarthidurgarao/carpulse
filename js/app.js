document.addEventListener('DOMContentLoaded', () => {
  // Navigation elements
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view-section');
  
  // Connection panel elements
  const btnConnectSerial = document.getElementById('btnConnectSerial');
  const btnConnectBluetooth = document.getElementById('btnConnectBluetooth');
  const btnConnectSimulation = document.getElementById('btnConnectSimulation');
  const btnDisconnect = document.getElementById('btnDisconnect');
  const connectionDot = document.getElementById('connectionDot');
  const connectionStatusText = document.getElementById('connectionStatusText');
  
  // Dashboard Value elements
  const valRpm = document.getElementById('valRpm');
  const valSpeed = document.getElementById('valSpeed');
  const valCoolant = document.getElementById('valCoolant');
  const valLoad = document.getElementById('valLoad');
  const valThrottle = document.getElementById('valThrottle');
  const valVoltage = document.getElementById('valVoltage');
  
  const rpmGaugeFill = document.getElementById('rpmGaugeFill');
  const speedGaugeFill = document.getElementById('speedGaugeFill');
  
  // Diagnostics elements
  const btnScanDtc = document.getElementById('btnScanDtc');
  const btnClearDtc = document.getElementById('btnClearDtc');
  const diagIconStatus = document.getElementById('diagIconStatus');
  const diagStatusTitle = document.getElementById('diagStatusTitle');
  const diagStatusDesc = document.getElementById('diagStatusDesc');
  const dtcListContainer = document.getElementById('dtcListContainer');

  // Chart Canvas setup
  const canvas = document.getElementById('liveTelemetryChart');
  const ctx = canvas.getContext('2d');
  
  // Drivers & state
  let driver = null; // OBD2Driver or OBD2Simulation
  let isSimulated = false;
  let telemetryHistory = [];
  const MAX_HISTORY = 80;

  // Track active graph items
  const activeParams = {
    rpm: true,
    speed: true,
    coolantTemp: true,
    engineLoad: true
  };

  // --- COMPATIBILITY CHECKS ---
  const compatibilityNotice = document.getElementById('compatibilityNotice');
  const supportsBluetooth = !!navigator.bluetooth;
  const supportsSerial = !!navigator.serial;

  if (!supportsBluetooth && !supportsSerial) {
    if (compatibilityNotice) compatibilityNotice.style.display = 'block';
    btnConnectSerial.style.opacity = '0.4';
    btnConnectBluetooth.style.opacity = '0.4';
  } else {
    if (!supportsSerial) {
      btnConnectSerial.style.opacity = '0.4';
      btnConnectSerial.title = 'USB Serial is not supported on this browser/device';
    }
    if (!supportsBluetooth) {
      btnConnectBluetooth.style.opacity = '0.4';
      btnConnectBluetooth.title = 'Web Bluetooth is not supported on this browser/device';
    }
  }

  // --- VIEW ROUTING ---
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(i => i.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));
      
      item.classList.add('active');
      const targetView = item.getAttribute('data-view');
      document.getElementById(`view${targetView.charAt(0).toUpperCase() + targetView.slice(1)}`).classList.add('active');
      
      if (targetView === 'graph') {
        resizeCanvas();
      }
    });
  });

  // Toggle Graph Parameters from Legend
  document.querySelectorAll('.graph-legend .legend-item').forEach(legend => {
    legend.addEventListener('click', () => {
      const param = legend.getAttribute('data-param');
      activeParams[param] = !activeParams[param];
      if (activeParams[param]) {
        legend.style.opacity = '1';
      } else {
        legend.style.opacity = '0.35';
      }
    });
  });

  // --- DEVICE CONNECTION MANAGEMENT ---

  function updateConnectionUI(status) {
    // status: 'connected' | 'connecting' | 'disconnected'
    connectionDot.className = 'connection-dot';
    btnConnectSerial.style.display = 'inline-flex';
    btnConnectBluetooth.style.display = 'inline-flex';
    btnConnectSimulation.style.display = 'inline-flex';
    btnDisconnect.style.display = 'none';

    if (status === 'connected') {
      connectionDot.classList.add('connected');
      connectionStatusText.textContent = isSimulated ? 'Simulation Mode' : 'OBD2 Active';
      connectionStatusText.style.color = 'var(--accent-green)';
      btnConnectSerial.style.display = 'none';
      btnConnectBluetooth.style.display = 'none';
      btnConnectSimulation.style.display = 'none';
      btnDisconnect.style.display = 'inline-flex';
    } else if (status === 'connecting') {
      connectionDot.classList.add('connecting');
      connectionStatusText.textContent = 'Connecting...';
      connectionStatusText.style.color = 'var(--accent-yellow)';
    } else {
      connectionStatusText.textContent = 'Disconnected';
      connectionStatusText.style.color = 'var(--accent-red)';
    }
  }

  async function handleConnect(type) {
    updateConnectionUI('connecting');
    try {
      if (type === 'simulation') {
        isSimulated = true;
        driver = new OBD2Simulation();
        driver.start(handleTelemetryUpdate);
        updateConnectionUI('connected');
      } else {
        isSimulated = false;
        driver = new OBD2Driver();
        if (type === 'serial') {
          await driver.connectSerial();
        } else {
          await driver.connectBluetooth();
        }
        updateConnectionUI('connected');
        driver.startPolling(handleTelemetryUpdate);
      }
      
      // Auto switch view to dashboard on successful connection
      document.getElementById('navDashboard').click();
    } catch (err) {
      console.error(err);
      alert(`Connection failed: ${err.message}`);
      updateConnectionUI('disconnected');
    }
  }

  async function handleDisconnect() {
    if (driver) {
      if (isSimulated) {
        driver.stop();
      } else {
        await driver.disconnect();
      }
      driver = null;
    }
    updateConnectionUI('disconnected');
    resetTelemetryDisplay();
  }

  btnConnectSerial.addEventListener('click', () => handleConnect('serial'));
  btnConnectBluetooth.addEventListener('click', () => handleConnect('bluetooth'));
  btnConnectSimulation.addEventListener('click', () => handleConnect('simulation'));
  btnDisconnect.addEventListener('click', handleDisconnect);

  // Additional diagnostic elements
  const valIntakeTemp = document.getElementById('valIntakeTemp');
  const valAmbientTemp = document.getElementById('valAmbientTemp');
  const valBaro = document.getElementById('valBaro');
  const valFuel = document.getElementById('valFuel');
  
  // Trip elements
  const valTripTime = document.getElementById('valTripTime');
  const valTripDist = document.getElementById('valTripDist');
  const valTripAvgSpeed = document.getElementById('valTripAvgSpeed');
  const valTripFuel = document.getElementById('valTripFuel');

  // TPMS elements
  const valTpmsFL = document.getElementById('valTpmsFL');
  const valTpmsFLTemp = document.getElementById('valTpmsFLTemp');
  const valTpmsFR = document.getElementById('valTpmsFR');
  const valTpmsFRTemp = document.getElementById('valTpmsFRTemp');
  const valTpmsRL = document.getElementById('valTpmsRL');
  const valTpmsRLTemp = document.getElementById('valTpmsRLTemp');
  const valTpmsRR = document.getElementById('valTpmsRR');
  const valTpmsRRTemp = document.getElementById('valTpmsRRTemp');

  // Physical connection client-side trip variables
  let tripDurationClient = 0;
  let tripDistanceClient = 0;
  let lastUpdateTime = null;

  // --- TELEMETRY ENGINE & UI UPDATING ---

  function formatTime(sec) {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function handleTelemetryUpdate(data) {
    // Update raw stats
    valRpm.textContent = data.rpm || 0;
    valSpeed.textContent = data.speed || 0;
    valCoolant.textContent = data.coolantTemp !== undefined ? data.coolantTemp : '--';
    valLoad.textContent = data.engineLoad !== undefined ? data.engineLoad : '--';
    valThrottle.textContent = data.throttlePos !== undefined ? data.throttlePos : '--';
    valVoltage.textContent = data.voltage !== undefined ? data.voltage : '--';

    // Update extra diagnostics sensors
    if (valIntakeTemp) valIntakeTemp.textContent = data.intakeTemp !== undefined ? data.intakeTemp : '--';
    if (valAmbientTemp) valAmbientTemp.textContent = data.ambientTemp !== undefined ? data.ambientTemp : '--';
    if (valBaro) valBaro.textContent = data.baroPressure !== undefined ? data.baroPressure : '--';
    if (valFuel) valFuel.textContent = data.fuelLevel !== undefined ? data.fuelLevel : '--';

    // Update Trip details
    if (data.trip) {
      // Simulation mode sends trip calculations directly
      if (valTripTime) valTripTime.textContent = formatTime(data.trip.duration);
      if (valTripDist) valTripDist.textContent = data.trip.distance.toFixed(1);
      if (valTripAvgSpeed) valTripAvgSpeed.textContent = data.trip.avgSpeed;
      if (valTripFuel) valTripFuel.textContent = data.trip.fuelUsed.toFixed(2);
    } else {
      // Calculate client-side trip info for physical OBD devices
      const now = Date.now();
      if (lastUpdateTime) {
        const deltaSec = (now - lastUpdateTime) / 1000;
        tripDurationClient += deltaSec;
        // distance = speed (km/h) * hours
        tripDistanceClient += (data.speed || 0) * (deltaSec / 3600);
        
        if (valTripTime) valTripTime.textContent = formatTime(Math.round(tripDurationClient));
        if (valTripDist) valTripDist.textContent = tripDistanceClient.toFixed(1);
        if (valTripAvgSpeed) {
          const avg = tripDistanceClient / (tripDurationClient / 3600 || 1);
          valTripAvgSpeed.textContent = Math.round(avg);
        }
        if (valTripFuel) {
          // Approximate fuel logic for trip metric (approx 8.0 L/100km average)
          const estFuel = (tripDistanceClient * 8.0) / 100;
          valTripFuel.textContent = estFuel.toFixed(2);
        }
      }
      lastUpdateTime = now;
    }

    // Update TPMS details
    const tpmsData = data.tpms || {
      fl: { press: 33.0, temp: 24 },
      fr: { press: 33.0, temp: 24 },
      rl: { press: 32.0, temp: 24 },
      rr: { press: 32.0, temp: 24 }
    };
    
    if (valTpmsFL) valTpmsFL.textContent = tpmsData.fl.press;
    if (valTpmsFLTemp) valTpmsFLTemp.textContent = tpmsData.fl.temp;
    if (valTpmsFR) valTpmsFR.textContent = tpmsData.fr.press;
    if (valTpmsFRTemp) valTpmsFRTemp.textContent = tpmsData.fr.temp;
    if (valTpmsRL) valTpmsRL.textContent = tpmsData.rl.press;
    if (valTpmsRLTemp) valTpmsRLTemp.textContent = tpmsData.rl.temp;
    if (valTpmsRR) valTpmsRR.textContent = tpmsData.rr.press;
    if (valTpmsRRTemp) valTpmsRRTemp.textContent = tpmsData.rr.temp;

    // Apply color indicators to tires if pressure is too high or low
    const alertTire = (elId, press) => {
      const box = document.getElementById(elId);
      if (box) {
        if (press < 29 || press > 38) {
          box.style.color = 'var(--accent-red)';
        } else {
          box.style.color = '';
        }
      }
    };
    alertTire('tpmsFL', tpmsData.fl.press);
    alertTire('tpmsFR', tpmsData.fr.press);
    alertTire('tpmsRL', tpmsData.rl.press);
    alertTire('tpmsRR', tpmsData.rr.press);

    // 1. RPM Gauge (0 to 7000 scale)
    const maxRpm = 7000;
    const rpmPercent = Math.min(100, ((data.rpm || 0) / maxRpm) * 100);
    const rpmOffset = 339 - (254 * (rpmPercent / 100));
    rpmGaugeFill.style.strokeDashoffset = rpmOffset;
    
    if (data.rpm > 5000) {
      rpmGaugeFill.style.stroke = 'var(--accent-red)';
    } else {
      rpmGaugeFill.style.stroke = 'var(--accent-cyan)';
    }

    // 2. Speed Gauge (0 to 180 scale)
    const maxSpeed = 180;
    const speedPercent = Math.min(100, ((data.speed || 0) / maxSpeed) * 100);
    const speedOffset = 339 - (254 * (speedPercent / 100));
    speedGaugeFill.style.strokeDashoffset = speedOffset;

    // Append to live charts history
    telemetryHistory.push(data);
    if (telemetryHistory.length > MAX_HISTORY) {
      telemetryHistory.shift();
    }
  }

  function resetTelemetryDisplay() {
    valRpm.textContent = '0';
    valSpeed.textContent = '0';
    valCoolant.textContent = '--';
    valLoad.textContent = '--';
    valThrottle.textContent = '--';
    valVoltage.textContent = '--';

    if (valIntakeTemp) valIntakeTemp.textContent = '--';
    if (valAmbientTemp) valAmbientTemp.textContent = '--';
    if (valBaro) valBaro.textContent = '--';
    if (valFuel) valFuel.textContent = '--';

    if (valTripTime) valTripTime.textContent = '00:00';
    if (valTripDist) valTripDist.textContent = '0.0';
    if (valTripAvgSpeed) valTripAvgSpeed.textContent = '0';
    if (valTripFuel) valTripFuel.textContent = '0.00';

    if (valTpmsFL) valTpmsFL.textContent = '--';
    if (valTpmsFR) valTpmsFR.textContent = '--';
    if (valTpmsRL) valTpmsRL.textContent = '--';
    if (valTpmsRR) valTpmsRR.textContent = '--';

    tripDurationClient = 0;
    tripDistanceClient = 0;
    lastUpdateTime = null;
    
    rpmGaugeFill.style.strokeDashoffset = 339;
    speedGaugeFill.style.strokeDashoffset = 339;
    telemetryHistory = [];
  }

  // --- DIAGNOSTICS & FAULT CODES ACTIONS ---

  btnScanDtc.addEventListener('click', async () => {
    if (!driver) {
      alert('Please connect to an OBD2 interface first.');
      return;
    }
    
    diagStatusTitle.textContent = 'Scanning ECU...';
    diagStatusDesc.textContent = 'Interrogating ECU fault code libraries.';
    diagIconStatus.className = 'diag-icon-status';
    dtcListContainer.innerHTML = '<div style="text-align:center; padding: 20px;">Scanning OBD2 codes...</div>';

    try {
      const codes = await driver.getDTCs ? await driver.getDTCs() : await driver.readDTCs();
      displayDTCs(codes);
    } catch (err) {
      diagStatusTitle.textContent = 'Scan Failed';
      diagStatusDesc.textContent = 'Could not communicate with vehicle ECU.';
      dtcListContainer.innerHTML = `<div style="color:var(--accent-red); text-align:center; padding: 20px;">Error: ${err.message}</div>`;
    }
  });

  btnClearDtc.addEventListener('click', async () => {
    if (!driver) {
      alert('Please connect to an OBD2 interface first.');
      return;
    }
    if (confirm('Clear Diagnostic Trouble Codes (DTC) and reset Engine Warning Light?')) {
      diagStatusTitle.textContent = 'Clearing ECU Codes...';
      diagStatusDesc.textContent = 'Sending clear codes (Mode 04) sequence.';
      try {
        await driver.clearDTCs();
        diagStatusTitle.textContent = 'Codes Cleared';
        diagStatusDesc.textContent = 'ECU reported successful fault reset. MIL off.';
        diagIconStatus.className = 'diag-icon-status';
        dtcListContainer.innerHTML = '<div class="diag-status-desc" style="text-align: center; margin-top: 40px;">No diagnostic fault codes active.</div>';
      } catch (err) {
        alert(`Failed to clear codes: ${err.message}`);
      }
    }
  });

  function displayDTCs(codes) {
    dtcListContainer.innerHTML = '';
    if (codes.length === 0) {
      diagStatusTitle.textContent = 'System Healthy';
      diagStatusDesc.textContent = 'No OBD2 fault codes stored in vehicle ECU memory.';
      diagIconStatus.className = 'diag-icon-status';
      dtcListContainer.innerHTML = '<div class="diag-status-desc" style="text-align: center; margin-top: 40px;">No diagnostic fault codes active.</div>';
    } else {
      diagStatusTitle.textContent = `${codes.length} Faults Found`;
      diagStatusDesc.textContent = 'Warning: Vehicle diagnostic codes are active. Please service.';
      diagIconStatus.className = 'diag-icon-status error';
      
      codes.forEach(dtc => {
        const item = document.createElement('div');
        item.className = 'code-item';
        item.innerHTML = `
          <div class="code-badge-container">
            <span class="code-badge">${dtc.code}</span>
            <div class="code-info">
              <span class="code-title">${dtc.title}</span>
              <span class="code-desc">${dtc.desc}</span>
            </div>
          </div>
          <span class="code-severity severity-${dtc.severity}">${dtc.severity}</span>
        `;
        dtcListContainer.appendChild(item);
      });
    }
  }

  // --- HIGH-PERFORMANCE CANVAS CHART RENDERER ---

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }

  window.addEventListener('resize', resizeCanvas);

  function drawLiveChart() {
    requestAnimationFrame(drawLiveChart);
    if (!canvas.offsetParent) return; // Stop drawing if graph tab is hidden
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Draw background grids
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    const gridCols = 8;
    const gridRows = 4;
    
    for (let i = 0; i <= gridCols; i++) {
      const x = (width / gridCols) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let i = 0; i <= gridRows; i++) {
      const y = (height / gridRows) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (telemetryHistory.length < 2) {
      // Draw placeholder guide
      ctx.fillStyle = '#64748b';
      ctx.font = `${14 * window.devicePixelRatio}px Outfit`;
      ctx.textAlign = 'center';
      ctx.fillText('Awaiting real-time OBD2 telemetry stream...', width / 2, height / 2);
      return;
    }

    // Parameters to draw
    const params = [
      { key: 'rpm', color: '#00f0ff', maxVal: 7000, scaleFunc: v => v },
      { key: 'speed', color: '#39ff14', maxVal: 180, scaleFunc: v => v },
      { key: 'coolantTemp', color: '#ffcc00', maxVal: 120, scaleFunc: v => v },
      { key: 'engineLoad', color: '#ff3366', maxVal: 100, scaleFunc: v => v }
    ];

    params.forEach(p => {
      if (!activeParams[p.key]) return;

      ctx.beginPath();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * window.devicePixelRatio;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // Set glow path properties
      ctx.shadowBlur = 10 * window.devicePixelRatio;
      ctx.shadowColor = p.color;

      for (let i = 0; i < telemetryHistory.length; i++) {
        const val = telemetryHistory[i][p.key] || 0;
        const normVal = Math.min(1.0, val / p.maxVal);
        
        // Calculate coordinate points
        const x = (width / (MAX_HISTORY - 1)) * i;
        const y = height - (normVal * (height - 40)) - 20;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });

    // Reset shadow properties to prevent bleeding into next frame render
    ctx.shadowBlur = 0;
  }

  // Fire up canvas charts draw loop
  drawLiveChart();
});
