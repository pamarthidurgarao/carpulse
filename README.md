# CarPulse OBD2 Dashboard (PWA)

CarPulse is a premium, high-performance Progressive Web App (PWA) designed to read, display, and diagnose car telemetry from OBD2 ELM327 adapters.

## Key Features

- **CarPlay Layout**: Landscape-first optimization with side navigation, high-contrast neon indicators, and large touch targets suitable for in-car dashboard mounts. 
- **Universal Mobile Support**: Fully compatible with both Android (Web Bluetooth/Serial) and iOS (runnable inside BLE-enabled browsers like **Bluefy** or **WebBLE**).
- **Diagnostics Scanner**: Scans, decodes, and clears active vehicle Diagnostic Trouble Codes (DTCs / Engine Check lights).
- **TPMS Dashboard**: Visual 4-wheel layout showing active tire pressures (PSI) and temperatures.
- **Trip Computer**: Displays elapsed time, distance traveled, average speed, and estimated fuel consumption.
- **Diagnostics Sensors**: Deep dive views of Intake Temperature, Ambient Temperature, Barometric Pressure, and Fuel Level.
- **Telemetry Graphing**: Canvas-rendered real-time scrolling charts.
- **Offline Capable**: Configured with a Service Worker to load instantly without internet.

## Getting Started

### Local Setup
1. Clone this repository or download the files.
2. Serve the directory using any HTTP server:
   ```bash
   npx http-server -p 8080
   ```
3. Open `http://localhost:8080` in a Chromium browser.

### How to use BLE on iPhone / iOS
Since standard iOS Safari does not support Web Bluetooth:
1. Download a BLE web browser from the App Store (e.g., **Bluefy** or **WebBLE**).
2. Point the browser to your deployed HTTPS link.
3. Turn on your car's BLE OBD2 adapter and press **BLE Dongle** to connect.

## GitHub Pages Deployment
To deploy this application to GitHub Pages:
1. Create a repository on GitHub.
2. Push this project to your repository.
3. Go to **Settings > Pages**.
4. Under **Build and deployment > Branch**, select `main` (or the branch you pushed to) and `/ (root)`, then click **Save**.
5. Once built, GitHub will provide an `https://` link which is fully compliant with Web Bluetooth/Serial security standards.
