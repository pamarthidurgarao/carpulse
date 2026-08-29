class OBD2Simulation {
  constructor() {
    this.intervalId = null;
    this.onDataCallback = null;
    
    // Telemetry state variables
    this.rpm = 800;
    this.speed = 0;
    this.coolantTemp = 45; // Start cool, warms up
    this.engineLoad = 15;
    this.throttlePos = 10;
    this.voltage = 13.8;
    this.fuelLevel = 68.0;
    
    // Extra sensors
    this.intakeTemp = 32;
    this.ambientTemp = 26;
    this.baroPressure = 101;
    this.fuelFlow = 0; // L/h
    
    // TPMS simulation (pressures in PSI, temps in °C)
    this.tpms = {
      fl: { press: 33.1, temp: 34 },
      fr: { press: 33.4, temp: 35 },
      rl: { press: 32.0, temp: 31 },
      rr: { press: 32.2, temp: 32 }
    };
    
    // Trip Computer state
    this.tripDuration = 0; // seconds
    this.tripDistance = 0; // km
    this.tripFuelUsed = 0; // Liters
    
    // Simulation state control
    this.time = 0;
    this.accelerating = true;
    
    // Diagnostic Trouble Codes (DTC)
    this.dtcs = [
      { code: 'P0300', title: 'Random/Multiple Misfire', desc: 'Powertrain ignition system fault detected.', severity: 'high' },
      { code: 'P0171', title: 'System Too Lean (Bank 1)', desc: 'Fuel system air-to-fuel ratio imbalance.', severity: 'medium' }
    ];
    this.dtcActive = true;
  }

  start(onData) {
    this.onDataCallback = onData;
    this.intervalId = setInterval(() => this.update(), 250);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  update() {
    this.time += 0.25;
    this.tripDuration += 0.25;

    // Simulate accelerator pedal cycle (accelerate for 15s, decelerate for 15s)
    const cycleTime = this.time % 30;
    if (cycleTime < 12) {
      // Accelerating
      this.rpm += Math.random() * 400 + 150;
      if (this.rpm > 5500) this.rpm = 5500;
      this.speed += Math.random() * 4 + 1.5;
      if (this.speed > 120) this.speed = 120;
      this.engineLoad = Math.min(85, this.engineLoad + Math.random() * 8 + 3);
      this.throttlePos = Math.min(78, this.throttlePos + Math.random() * 5 + 2);
    } else if (cycleTime < 18) {
      // Cruising
      this.rpm = 2500 + Math.sin(this.time) * 100 + Math.random() * 30;
      this.speed = 90 + Math.sin(this.time) * 2;
      this.engineLoad = 35 + Math.random() * 5;
      this.throttlePos = 30 + Math.random() * 2;
    } else {
      // Decelerating/braking
      this.rpm -= Math.random() * 350 + 100;
      if (this.rpm < 800) this.rpm = 800 + Math.random() * 50;
      this.speed -= Math.random() * 5 + 2;
      if (this.speed < 0) this.speed = 0;
      this.engineLoad = Math.max(10, this.engineLoad - Math.random() * 10 - 2);
      this.throttlePos = Math.max(8, this.throttlePos - Math.random() * 6 - 2);
    }

    // Warm up coolant temperature slowly
    if (this.coolantTemp < 92) {
      this.coolantTemp += 0.05;
    } else {
      this.coolantTemp = 92 + Math.sin(this.time / 10) * 0.8;
    }

    // Small voltage noise
    this.voltage = 13.9 + Math.sin(this.time) * 0.15;
    
    // Slow fuel consumption
    this.fuelLevel = Math.max(0, this.fuelLevel - 0.0005);

    // Trip calculations: distance (km) = speed (km/h) * hours
    const hoursElapsed = 0.25 / 3600;
    this.tripDistance += this.speed * hoursElapsed;
    
    // Fuel flow simulation: approx 2.0 L/h at idle up to 25.0 L/h under load
    this.fuelFlow = (this.rpm / 1000) * 2.5 + (this.engineLoad / 100) * 12.0;
    this.tripFuelUsed += this.fuelFlow * hoursElapsed;

    // Simulate small changes in tire pressures and temps due to friction/speed
    const speedFactor = this.speed / 100;
    this.tpms.fl.press = parseFloat((33.0 + Math.sin(this.time / 20) * 0.2 + speedFactor * 0.5).toFixed(1));
    this.tpms.fr.press = parseFloat((33.3 + Math.sin(this.time / 22) * 0.2 + speedFactor * 0.5).toFixed(1));
    this.tpms.rl.press = parseFloat((32.0 + Math.sin(this.time / 25) * 0.15 + speedFactor * 0.4).toFixed(1));
    this.tpms.rr.press = parseFloat((32.2 + Math.sin(this.time / 24) * 0.15 + speedFactor * 0.4).toFixed(1));
    
    this.tpms.fl.temp = Math.round(34 + speedFactor * 8 + Math.sin(this.time / 50) * 2);
    this.tpms.fr.temp = Math.round(35 + speedFactor * 9 + Math.sin(this.time / 48) * 2);
    this.tpms.rl.temp = Math.round(31 + speedFactor * 6 + Math.sin(this.time / 60) * 1.5);
    this.tpms.rr.temp = Math.round(32 + speedFactor * 6 + Math.sin(this.time / 55) * 1.5);

    // Extra sensor adjustments
    this.intakeTemp = Math.round(30 + (this.engineLoad / 10) + Math.sin(this.time / 30) * 1.5);
    this.ambientTemp = Math.round(26 + Math.sin(this.time / 120) * 0.5);
    this.baroPressure = Math.round(101 + Math.sin(this.time / 200) * 0.2);

    if (this.onDataCallback) {
      this.onDataCallback({
        rpm: Math.round(this.rpm),
        speed: Math.round(this.speed),
        coolantTemp: Math.round(this.coolantTemp),
        engineLoad: Math.round(this.engineLoad),
        throttlePos: Math.round(this.throttlePos),
        voltage: parseFloat(this.voltage.toFixed(2)),
        fuelLevel: parseFloat(this.fuelLevel.toFixed(1)),
        intakeTemp: this.intakeTemp,
        ambientTemp: this.ambientTemp,
        baroPressure: this.baroPressure,
        fuelFlow: parseFloat(this.fuelFlow.toFixed(1)),
        tpms: this.tpms,
        trip: {
          duration: Math.round(this.tripDuration),
          distance: parseFloat(this.tripDistance.toFixed(2)),
          fuelUsed: parseFloat(this.tripFuelUsed.toFixed(3)),
          avgSpeed: Math.round(this.tripDistance / (this.tripDuration / 3600 || 1))
        }
      });
    }
  }

  getDTCs() {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(this.dtcActive ? [...this.dtcs] : []);
      }, 1000);
    });
  }

  clearDTCs() {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.dtcActive = false;
        resolve(true);
      }, 1500);
    });
  }

  triggerDTC() {
    this.dtcActive = true;
  }
}
window.OBD2Simulation = OBD2Simulation;
