# Ethara.ai Time Tracker Suite

A comprehensive tracking solution built for monitoring employee login hours, active work durations, idle states, and task completions on the MultiMango data annotation platform.

The suite is divided into three key components:
1. **Admin Web Dashboard**: A central Node.js & Express server to visually manage team metrics, compare attendance logs with SAP punch cards, and sync records to Google Sheets in real-time.
2. **Python Desktop App Tracker**: A system-wide time tracker that detects active window titles and keyboard/mouse events to calculate true active and idle time.
3. **Chrome Extension**: A browser-level tracker featuring real-time syncing and automated Google Forms daily log auto-filling.

---

## 📁 Repository Directory Structure
* **`/dashboard`**: Node.js & Express web server serving the real-time Admin Portal.
* **`/desktop-app`**: Python client application using Tkinter for UI and pynput for system-wide input tracking.
* **`/extension`**: Manifest V3 Chrome Extension.

---

## 🚀 Component 1: Admin Web Dashboard (`/dashboard`)
Serves a sleek, dark-themed admin console where team leads can inspect daily metrics, manage projects, and export reports.

### Features
- **Real-Time Board**: Displays active workers, total tasks submitted, and average idle ratios.
- **SAP Comparison Engine**: Upload SAP time clock CSVs, map columns, and compute discrepancy logs.
- **Google Sheets Link**: Real-time webhook forwarding to append synced data directly to a Google Sheet.

### Setup and Local Execution
1. Install Node.js (v18+ recommended).
2. Open your terminal and navigate to `/dashboard`:
   ```bash
   cd dashboard
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Open browser at: **`http://localhost:3000`**

---

## 🚀 Component 2: Python Desktop Tracker (`/desktop-app`)
Monitors overall keyboard/mouse activity across all apps and flags users as active or idle relative to browser window focus.

### Installation & Run
1. Ensure Python 3 is installed.
2. Install pip dependencies:
   ```bash
   pip install -r desktop-app/requirements.txt
   ```
3. Start the application:
   ```bash
   python desktop-app/main.py
   ```
4. Fill in **Employee Name**, **Employee ID**, **Sync Server URL** (e.g. `http://localhost:3000` or your Render URL), and click **Save Settings**.

---

## 🚀 Component 3: Chrome Extension (`/extension`)
Tracks MultiMango browser tabs and offers seamless Google Forms auto-filling.

### Installation in Chrome
1. Navigate to `chrome://extensions` in Google Chrome.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Browse and select the `/extension` directory from this project.
5. Set your **Sync URL** in the extension settings to publish metrics to the dashboard.

---

## ⚙️ Integrations Setup

### 📊 Google Sheets Link
Every sync can append directly to a Google Sheet using Google Apps Script:
1. Open a Google Sheet, select **Extensions** -> **Apps Script**.
2. Paste the script code (from `/dashboard/server.js` or project notes) and save.
3. Deploy as a **Web App**, set access to **Anyone**, and copy the deploy URL.
4. Set the copied URL as the `GOOGLE_SHEETS_WEBHOOK_URL` environment variable on Render, or save it in the Admin Dashboard UI (under Reports & Export).

### 📝 Google Forms Auto-fill
When an employee opens a reporting Google Form, a floating widget labeled **Ethara.ai Auto-fill** will render in the bottom-right corner. Click **Auto-fill Today's Log** to fill the matching name, ID, date, task, and work hour fields instantly.

---

## ☁️ Deploying to Render
To deploy your dashboard live:
1. Link your GitHub repository to a new **Web Service** on Render.
2. Configure settings:
   - **Build Command**: `npm install --prefix dashboard`
   - **Start Command**: `node dashboard/server.js`
3. Add the following **Environment Variable**:
   - **Key**: `GOOGLE_SHEETS_WEBHOOK_URL`
   - **Value**: *Your Google Apps Script Web App URL*
