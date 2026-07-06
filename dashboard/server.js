const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database structure
let database = {
  history: {}, // Schema: { "YYYY-MM-DD": { "employeeId": { ...employeeMetrics } } }
  googleSheetsWebhookUrl: ""
};

// Load database from file on start
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      database = JSON.parse(data);
      if (!database.history) {
        database.history = {};
      }
      console.log('Database loaded successfully.');
    } else {
      saveDatabase();
      console.log('Database file created.');
    }
  } catch (err) {
    console.error('Error loading database:', err.message);
  }
}

// Save database to file
function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(database, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving database:', err.message);
  }
}

// Helper to get YYYY-MM-DD string
function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Background sweep to mark stale online sessions as offline
// If we haven't heard from a client in 30 seconds, they are considered offline.
setInterval(() => {
  let changed = false;
  const now = Date.now();
  
  for (const date in database.history) {
    for (const empId in database.history[date]) {
      const emp = database.history[date][empId];
      if (emp.isOnline && (now - emp.lastUpdated > 30000)) {
        emp.isOnline = false;
        emp.status = "Offline";
        emp.lastUpdated = now;
        changed = true;
      }
    }
  }

  if (changed) {
    saveDatabase();
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

// API: Sync metrics from Employee clients (Extension or Desktop App)
app.post('/api/sync', (req, res) => {
  const { 
    employeeId, 
    employeeName, 
    date, 
    activeProject, 
    loginTime, 
    activeTime, 
    idleTime, 
    projects, 
    isOnline, 
    status 
  } = req.body;

  if (!employeeId || !employeeName) {
    return res.status(400).json({ error: 'Missing employeeId or employeeName' });
  }

  const syncDate = date || getTodayString();

  if (!database.history[syncDate]) {
    database.history[syncDate] = {};
  }

  const record = {
    employeeId,
    employeeName,
    activeProject: activeProject || 'General',
    loginTime: loginTime || 0,
    activeTime: activeTime || 0,
    idleTime: idleTime || 0,
    projects: projects || {},
    isOnline: isOnline !== undefined ? isOnline : true,
    status: status || 'Working',
    lastUpdated: Date.now()
  };

  // Update employee record
  database.history[syncDate][employeeId] = record;
  saveDatabase();

  // Forward to Google Sheets if configured
  if (database.googleSheetsWebhookUrl) {
    forwardToGoogleSheets(database.googleSheetsWebhookUrl, syncDate, record);
  }

  res.json({ success: true });
});

// API: Retrieve employees for a specific date (defaults to today)
app.get('/api/employees', (req, res) => {
  const dateQuery = req.query.date || getTodayString();
  const dayRecords = database.history[dateQuery] || {};
  res.json(dayRecords);
});

// API: Retrieve historical data for CSV generation
app.get('/api/history', (req, res) => {
  res.json(database.history);
});

// API: Get and set dashboard settings
app.get('/api/settings', (req, res) => {
  res.json({ googleSheetsWebhookUrl: database.googleSheetsWebhookUrl || "" });
});

app.post('/api/settings', (req, res) => {
  const { googleSheetsWebhookUrl } = req.body;
  database.googleSheetsWebhookUrl = googleSheetsWebhookUrl || "";
  saveDatabase();
  res.json({ success: true });
});

// Start Server
app.listen(PORT, () => {
  loadDatabase();
  console.log(`Ethara.ai Tracker Admin Server running on http://localhost:${PORT}`);
});
