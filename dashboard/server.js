const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get YYYY-MM-DD string
function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Background sweep to mark stale online sessions as offline
// If we haven't heard from a client in 30 seconds, they are considered offline.
setInterval(async () => {
  try {
    await db.sweepStaleSessions(30000);
  } catch (err) {
    console.error("Error sweeping stale sessions:", err.message);
  }
}, 10000);

// Forward data to Google Sheets Apps Script URL
function forwardToGoogleSheets(webhookUrl, date, record) {
  let tasks = 0;
  for (const p in record.projects) {
    tasks += record.projects[p].taskCount;
  }

  const payload = {
    date: date,
    employeeId: record.employeeId,
    employeeName: record.employeeName,
    activeProject: record.activeProject,
    loginHours: parseFloat((record.loginTime / 3600000).toFixed(2)),
    workHours: parseFloat((record.activeTime / 3600000).toFixed(2)),
    idleHours: parseFloat((record.idleTime / 3600000).toFixed(2)),
    breakHours: parseFloat(((record.breakTime || 0) / 3600000).toFixed(2)),
    tasksCompleted: tasks,
    status: record.status
  };

  fetch(webhookUrl, {
    method: 'POST',
    mode: 'no-cors', // allows posting to redirecting Apps Script URLs
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(err => {
    console.error("Google Sheets forward error:", err.message);
  });
}

// API: Verify Employee ID against the registry
app.get('/api/employees/verify', async (req, res) => {
  try {
    const empId = (req.query.id || '').trim();
    if (!empId) {
      return res.status(400).json({ error: 'Missing employee ID' });
    }
    const result = await db.verifyEmployee(empId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Retrieve full Employee Registry
app.get('/api/employees/registry', async (req, res) => {
  try {
    const list = await db.getRegistry();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Register a new employee
app.post('/api/employees/register', async (req, res) => {
  try {
    const { id, name, email } = req.body;
    if (!id || !name) {
      return res.status(400).json({ error: 'Missing id or name' });
    }
    await db.registerEmployee(id, name, email);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Sync metrics from Employee clients (Extension or Desktop App)
app.post('/api/sync', async (req, res) => {
  try {
    const { 
      employeeId, 
      employeeName, 
      date, 
      activeProject, 
      loginTime, 
      activeTime, 
      idleTime, 
      breakTime,
      projects, 
      isOnline, 
      status 
    } = req.body;

    if (!employeeId || !employeeName) {
      return res.status(400).json({ error: 'Missing employeeId or employeeName' });
    }

    const syncDate = date || getTodayString();

    const record = {
      employeeId,
      employeeName,
      activeProject: activeProject || 'General',
      loginTime: loginTime || 0,
      activeTime: activeTime || 0,
      idleTime: idleTime || 0,
      breakTime: breakTime || 0,
      projects: projects || {},
      isOnline: isOnline !== undefined ? isOnline : true,
      status: status || 'Working',
      lastUpdated: Date.now()
    };

    // Save record to SQL database
    await db.syncRecord(record, syncDate);

    // Forward to Google Sheets if configured
    const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL || await db.getSetting('googleSheetsWebhookUrl');
    if (webhookUrl) {
      forwardToGoogleSheets(webhookUrl, syncDate, record);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Retrieve employees for a specific date (defaults to today)
app.get('/api/employees', async (req, res) => {
  try {
    const dateQuery = req.query.date || getTodayString();
    const dayRecords = await db.getDailyRecords(dateQuery);
    res.json(dayRecords);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Retrieve historical data for CSV generation
app.get('/api/history', async (req, res) => {
  try {
    const history = await db.getHistory();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get and set dashboard settings
app.get('/api/settings', async (req, res) => {
  try {
    const url = await db.getSetting('googleSheetsWebhookUrl');
    res.json({ googleSheetsWebhookUrl: process.env.GOOGLE_SHEETS_WEBHOOK_URL || url || "" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { googleSheetsWebhookUrl } = req.body;
    await db.saveSetting('googleSheetsWebhookUrl', googleSheetsWebhookUrl || "");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Initialize DB and start server
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Ethara.ai Tracker Admin Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error("Failed to initialize database:", err.message);
});
