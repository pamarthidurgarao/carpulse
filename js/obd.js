// OBD2 Driver supporting Web Serial (Desktop Chrome) & Web Bluetooth (BLE OBD2 on Mobile browsers like Bluefy/WebBLE)
class OBD2Driver {
  constructor() {
    this.connectionType = null; // 'serial' | 'bluetooth'
    this.serialPort = null;
    this.serialReader = null;
    this.serialWriter = null;
    
    // BLE Bluetooth properties
    this.bluetoothDevice = null;
    this.gattServer = null;
    this.rxCharacteristic = null;
    this.txCharacteristic = null;
    this.bluetoothReadBuffer = '';
    
    // Polling / Command queue state
    this.isPolling = false;
    this.commandQueue = [];
    this.currentResolver = null;
    this.currentRejecter = null;
    this.receivedBuffer = '';
    this.timeoutId = null;
    
    // BLE Services & Characteristics matching common ELM327 BLE adapters
    this.bleProfiles = [
      {
        // Nordic UART Service (NUS) - widely used by ELM327 BLE
        service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
        tx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // Write
        rx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e'  // Notify
      },
      {
        // FFE0 / FFE1 Generic BLE serial Profile
        service: '0000ffe0-0000-1000-8000-00805f9b34fb',
        tx: '0000ffe1-0000-1000-8000-00805f9b34fb',
        rx: '0000ffe1-0000-1000-8000-00805f9b34fb'
      },
      {
        // FFF0 / FFF1 Profile
        service: '0000fff0-0000-1000-8000-00805f9b34fb',
        tx: '0000fff1-0000-1000-8000-00805f9b34fb',
        rx: '0000fff2-0000-1000-8000-00805f9b34fb'
      }
    ];
  }

  // --- CONNECT METHODS ---

  async connectSerial() {
    if (!navigator.serial) {
      throw new Error('Web Serial API is not supported in this browser.');
    }
    
    try {
      this.serialPort = await navigator.serial.requestPort();
      await this.serialPort.open({ baudRate: 38400 });
      
      this.serialWriter = this.serialPort.writable.getWriter();
      this.connectionType = 'serial';
      
      // Start Serial reading loop
      this.readSerialLoop();
      
      // Initialize ELM327
      await this.initializeELM();
      return true;
    } catch (e) {
      console.error('Serial connection failed:', e);
      this.disconnect();
      throw e;
    }
  }

  async connectBluetooth() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is not supported in this browser. On iOS, please use Bluefy or WebBLE.');
    }

    try {
      const filters = this.bleProfiles.map(p => ({ services: [p.service] }));
      // Also request common OBD device name prefixes
      this.bluetoothDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: this.bleProfiles.map(p => p.service)
      });

      this.gattServer = await this.bluetoothDevice.gatt.connect();
      
      // Find working BLE Serial Service & Characteristics
      let serviceMatch = null;
      for (const profile of this.bleProfiles) {
        try {
          const service = await this.gattServer.getPrimaryService(profile.service);
          this.txCharacteristic = await service.getCharacteristic(profile.tx);
          this.rxCharacteristic = await service.getCharacteristic(profile.rx);
          serviceMatch = profile;
          break;
        } catch (err) {
          console.warn(`BLE Profile ${profile.service} not available on this device.`);
        }
      }

      if (!serviceMatch) {
        throw new Error('Could not find compatible BLE-to-Serial characteristics on this device.');
      }

      this.connectionType = 'bluetooth';

      // Start BLE Notifications
      await this.rxCharacteristic.startNotifications();
      this.rxCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = event.target.value;
        const decoder = new TextDecoder();
        const strChunk = decoder.decode(value);
        this.handleIncomingData(strChunk);
      });

      // Initialize ELM327
      await this.initializeELM();
      return true;
    } catch (e) {
      console.error('Bluetooth connection failed:', e);
      this.disconnect();
      throw e;
    }
  }

  async disconnect() {
    this.isPolling = false;
    this.commandQueue = [];
    
    if (this.currentRejecter) {
      this.currentRejecter(new Error('Connection closed.'));
      this.currentResolver = null;
      this.currentRejecter = null;
    }

    // Clean up Serial
    if (this.serialReader) {
      try { this.serialReader.cancel(); } catch(e){}
      this.serialReader = null;
    }
    if (this.serialWriter) {
      try { this.serialWriter.releaseLock(); } catch(e){}
      this.serialWriter = null;
    }
    if (this.serialPort) {
      try { await this.serialPort.close(); } catch(e){}
      this.serialPort = null;
    }

    // Clean up Bluetooth
    if (this.rxCharacteristic) {
      try { await this.rxCharacteristic.stopNotifications(); } catch(e){}
      this.rxCharacteristic = null;
    }
    if (this.bluetoothDevice && this.bluetoothDevice.gatt.connected) {
      this.bluetoothDevice.gatt.disconnect();
    }
    this.bluetoothDevice = null;
    this.gattServer = null;
    this.txCharacteristic = null;
    this.connectionType = null;
    this.receivedBuffer = '';
  }

  // --- SERIAL READ LOOP ---

  async readSerialLoop() {
    const textDecoder = new TextDecoder();
    while (this.serialPort && this.serialPort.readable) {
      try {
        this.serialReader = this.serialPort.readable.getReader();
        while (true) {
          const { value, done } = await this.serialReader.read();
          if (done) break;
          const chunk = textDecoder.decode(value);
          this.handleIncomingData(chunk);
        }
      } catch (err) {
        console.error('Serial read loop error:', err);
        break;
      } finally {
        if (this.serialReader) {
          this.serialReader.releaseLock();
          this.serialReader = null;
        }
      }
    }
  }

  // --- DATA FLOW HANDLER ---

  handleIncomingData(chunk) {
    this.receivedBuffer += chunk;
    // ELM327 commands terminate with a '>' prompt symbol
    if (this.receivedBuffer.includes('>')) {
      const parts = this.receivedBuffer.split('>');
      const fullResponse = parts[0];
      // Keep trailing data in buffer if any
      this.receivedBuffer = parts.slice(1).join('>');
      
      if (this.currentResolver) {
        if (this.timeoutId) clearTimeout(this.timeoutId);
        const resolveFunc = this.currentResolver;
        this.currentResolver = null;
        this.currentRejecter = null;
        resolveFunc(fullResponse.trim());
      }
      
      // Process next command in queue
      this.processNextCommand();
    }
  }

  // --- SENDER ENGINE ---

  sendCommand(cmd) {
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ cmd, resolve, reject });
      if (this.commandQueue.length === 1 && !this.currentResolver) {
        this.processNextCommand();
      }
    });
  }

  async processNextCommand() {
    if (this.commandQueue.length === 0) return;
    const { cmd, resolve, reject } = this.commandQueue.shift();
    
    this.currentResolver = resolve;
    this.currentRejecter = reject;
    
    // Set a timeout guard to prevent locking UI if connection drops
    this.timeoutId = setTimeout(() => {
      if (this.currentRejecter) {
        this.currentRejecter(new Error(`Command timeout: ${cmd}`));
        this.currentResolver = null;
        this.currentRejecter = null;
        this.processNextCommand();
      }
    }, 4500);

    try {
      const dataStr = cmd + '\r';
      const encoder = new TextEncoder();
      const bytes = encoder.encode(dataStr);

      if (this.connectionType === 'serial' && this.serialWriter) {
        await this.serialWriter.write(bytes);
      } else if (this.connectionType === 'bluetooth' && this.txCharacteristic) {
        // Send in MTU chunks if necessary, but standard ELM commands are small (< 20 bytes)
        await this.txCharacteristic.writeValueWithoutResponse(bytes);
      } else {
        throw new Error('Not connected to a physical device.');
      }
    } catch (err) {
      clearTimeout(this.timeoutId);
      reject(err);
      this.currentResolver = null;
      this.currentRejecter = null;
      this.processNextCommand();
    }
  }

  // --- ELM327 HANDSHAKE PROTOCOLS ---

  async initializeELM() {
    // Standard initialization sequence
    await this.sendCommand('ATZ');  // Reset
    await this.sendCommand('ATE0'); // Echo off
    await this.sendCommand('ATL0'); // Linefeeds off
    await this.sendCommand('ATS0'); // Spaces off
    await this.sendCommand('ATH0'); // Headers off
    await this.sendCommand('ATSP0'); // Auto Protocol Search
  }

  // --- OBD2 INTERACTION API ---

  async queryPID(pid) {
    // e.g. pid = '010C' (RPM)
    const raw = await this.sendCommand(pid);
    return this.parsePIDResponse(pid, raw);
  }

  parsePIDResponse(pid, raw) {
    // Normalise spaces/caps
    const clean = raw.replace(/[\r\n\s]/g, '').toUpperCase();
    
    // Check for errors
    if (clean.includes('NODATA') || clean.includes('ERROR') || clean.includes('UNABLE')) {
      return null;
    }

    // Expected prefix for '01xx' mode query is '41xx'
    const expectedPrefix = '41' + pid.substring(2);
    const prefixIdx = clean.indexOf(expectedPrefix);
    if (prefixIdx === -1) return null;
    
    // Extract hex values after the prefix
    const dataHex = clean.substring(prefixIdx + expectedPrefix.length);
    
    try {
      switch (pid) {
        case '010C': // RPM: ((A * 256) + B) / 4
          if (dataHex.length >= 4) {
            const a = parseInt(dataHex.substring(0, 2), 16);
            const b = parseInt(dataHex.substring(2, 4), 16);
            return Math.round(((a * 256) + b) / 4);
          }
          break;
        case '010D': // Speed: A (km/h)
          if (dataHex.length >= 2) {
            return parseInt(dataHex.substring(0, 2), 16);
          }
          break;
        case '0105': // Coolant Temp: A - 40 (°C)
          if (dataHex.length >= 2) {
            return parseInt(dataHex.substring(0, 2), 16) - 40;
          }
          break;
        case '0111': // Throttle Pos: A * 100 / 255 (%)
          if (dataHex.length >= 2) {
            return Math.round((parseInt(dataHex.substring(0, 2), 16) * 100) / 255);
          }
          break;
        case '0104': // Calculated Load: A * 100 / 255 (%)
          if (dataHex.length >= 2) {
            return Math.round((parseInt(dataHex.substring(0, 2), 16) * 100) / 255);
          }
          break;
        case '0142': // Control Module Voltage: ((A * 256) + B) / 1000 (V)
          if (dataHex.length >= 4) {
            const a = parseInt(dataHex.substring(0, 2), 16);
            const b = parseInt(dataHex.substring(2, 4), 16);
            return parseFloat((((a * 256) + b) / 1000).toFixed(2));
          }
          break;
        case '010F': // Intake Air Temp: A - 40 (°C)
          if (dataHex.length >= 2) {
            return parseInt(dataHex.substring(0, 2), 16) - 40;
          }
          break;
        case '0146': // Ambient Air Temp: A - 40 (°C)
          if (dataHex.length >= 2) {
            return parseInt(dataHex.substring(0, 2), 16) - 40;
          }
          break;
        case '0133': // Barometric Pressure: A (kPa)
          if (dataHex.length >= 2) {
            return parseInt(dataHex.substring(0, 2), 16);
          }
          break;
        case '012F': // Fuel Level: A * 100 / 255 (%)
          if (dataHex.length >= 2) {
            return Math.round((parseInt(dataHex.substring(0, 2), 16) * 100) / 255);
          }
          break;
      }
    } catch(err) {
      console.warn(`Failed parsing response for PID ${pid}:`, dataHex, err);
    }
    return null;
  }

  // Polling management
  async startPolling(onDataCallback, interval = 600) {
    this.isPolling = true;
    const pids = ['010C', '010D', '0105', '0104', '0111', '0142', '012F', '010F', '0146', '0133'];
    
    while (this.isPolling) {
      const dataObj = {};
      for (const pid of pids) {
        if (!this.isPolling) break;
        try {
          const val = await this.queryPID(pid);
          if (val !== null) {
            const labelMap = {
              '010C': 'rpm',
              '010D': 'speed',
              '0105': 'coolantTemp',
              '0104': 'engineLoad',
              '0111': 'throttlePos',
              '0142': 'voltage',
              '012F': 'fuelLevel',
              '010F': 'intakeTemp',
              '0146': 'ambientTemp',
              '0133': 'baroPressure'
            };
            dataObj[labelMap[pid]] = val;
          }
        } catch (e) {
          console.warn(`Polling error on PID ${pid}:`, e);
        }
      }
      
      if (Object.keys(dataObj).length > 0 && this.isPolling) {
        onDataCallback(dataObj);
      }
      
      // Wait interval
      await new Promise(r => setTimeout(r, interval));
    }
  }

  stopPolling() {
    this.isPolling = false;
  }

  // --- DIAGNOSTIC CODES INTERFACE ---

  async readDTCs() {
    const raw = await this.sendCommand('03'); // Read DTCs Mode 03
    return this.parseDTCResponse(raw);
  }

  parseDTCResponse(raw) {
    const clean = raw.replace(/[\r\n\s]/g, '').toUpperCase();
    if (clean.includes('NODATA') || clean.includes('NOCODES')) {
      return [];
    }
    
    const codes = [];
    // Mode 3 response starts with 43. Example: 43 02 03 00 01 71 -> DTC P0300, P0171
    if (clean.startsWith('43')) {
      const hexList = clean.substring(2);
      // Groups of 4 hex digits make up the codes
      for (let i = 0; i < hexList.length; i += 4) {
        const codeGroup = hexList.substring(i, i + 4);
        if (codeGroup.length === 4 && codeGroup !== '0000') {
          const dtc = this.decodeDTC(codeGroup);
          if (dtc) codes.push(dtc);
        }
      }
    }
    return codes;
  }

  decodeDTC(hex) {
    // Decoding OBD2 DTC code
    // Standard translation of first digit:
    // 0 -> P0, 1 -> P1, 2 -> P2, 3 -> P3
    // 4 -> C0, 5 -> C1, 6 -> C2, 7 -> C3
    // 8 -> B0, 9 -> B1, A -> B2, B -> B3
    // C -> U0, D -> U1, E -> U2, F -> U3
    const firstHex = hex.charAt(0);
    let system = 'P';
    if (firstHex === '4' || firstHex === '5' || firstHex === '6' || firstHex === '7') system = 'C';
    else if (firstHex === '8' || firstHex === '9' || firstHex === 'A' || firstHex === 'B') system = 'B';
    else if (firstHex === 'C' || firstHex === 'D' || firstHex === 'E' || firstHex === 'F') system = 'U';

    const firstVal = parseInt(firstHex, 16);
    const codeNum = (firstVal % 4).toString() + hex.substring(1);
    const code = system + codeNum;

    // Common standard library descriptions
    const dtcDb = {
      'P0300': { title: 'Random/Multiple Cylinder Misfire Detected', severity: 'high' },
      'P0171': { title: 'System Too Lean (Bank 1)', severity: 'medium' },
      'P0102': { title: 'Mass or Volume Air Flow Circuit Low Input', severity: 'medium' },
      'P0113': { title: 'Intake Air Temperature Sensor 1 Circuit High Input', severity: 'medium' },
      'P0115': { title: 'Engine Coolant Temperature Circuit Malfunction', severity: 'high' },
      'P0116': { title: 'Engine Coolant Temperature Circuit Range/Performance', severity: 'medium' },
      'P0301': { title: 'Cylinder 1 Misfire Detected', severity: 'high' },
      'P0302': { title: 'Cylinder 2 Misfire Detected', severity: 'high' },
      'P0420': { title: 'Catalyst System Efficiency Below Threshold (Bank 1)', severity: 'medium' },
      'P0500': { title: 'Vehicle Speed Sensor A Malfunction', severity: 'high' }
    };

    const details = dtcDb[code] || { title: 'Diagnostic Trouble Code', severity: 'medium' };
    return {
      code,
      title: details.title,
      desc: 'ECU reported diagnostic code warning.',
      severity: details.severity
    };
  }

  async clearDTCs() {
    await this.sendCommand('04'); // Send clear codes Mode 04 command
    return true;
  }
}
window.OBD2Driver = OBD2Driver;
