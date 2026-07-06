const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'tracker.db');
const db = new sqlite3.Database(dbPath);

// Helper to run query and return Promise
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Helper to get all rows
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Helper to get single row
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Database initialization
async function init() {
  await run(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT
    )
  `);

  // Migration: Add email column if table already existed without it
  try {
    await run(`ALTER TABLE employees ADD COLUMN email TEXT`);
    console.log("Added email column to employees table.");
  } catch (e) {
    // Column already exists, ignore
  }

  await run(`
    CREATE TABLE IF NOT EXISTS history (
      date TEXT,
      employeeId TEXT,
      employeeName TEXT,
      activeProject TEXT,
      loginTime INTEGER DEFAULT 0,
      activeTime INTEGER DEFAULT 0,
      idleTime INTEGER DEFAULT 0,
      breakTime INTEGER DEFAULT 0,
      projects TEXT, -- JSON string
      isOnline INTEGER DEFAULT 0,
      status TEXT,
      lastUpdated INTEGER,
      PRIMARY KEY (date, employeeId)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Pre-populate with 100 sample employees if empty
  const countRow = await get(`SELECT COUNT(*) as count FROM employees`);
  if (countRow.count === 0) {
    db.serialize(() => {
      const stmt = db.prepare(`INSERT OR IGNORE INTO employees (id, name, email) VALUES (?, ?, ?)`);
      for (let i = 1; i <= 100; i++) {
        const id = `EMP${String(i).padStart(3, '0')}`;
        stmt.run(id, `Employee ${i}`, `employee${i}@ethara.ai`);
      }
      stmt.finalize();
    });
    console.log('SQL Database pre-populated with 100 sample employees (including email).');
  }
}

// Verify employee ID
async function verifyEmployee(id) {
  const row = await get(`SELECT name, email FROM employees WHERE LOWER(id) = LOWER(?)`, [id.trim()]);
  return row ? { exists: true, name: row.name, email: row.email } : { exists: false };
}

// Get full employee registry
async function getRegistry() {
  return await all(`SELECT id, name, email FROM employees ORDER BY id ASC`);
}

// Register or update an employee record
async function registerEmployee(id, name, email) {
  await run(`
    INSERT INTO employees (id, name, email) 
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET 
      name = excluded.name,
      email = excluded.email
  `, [id.trim(), name.trim(), (email || '').trim()]);
  return true;
}

// Sync single employee record
async function syncRecord(record, date) {
  const projectsJson = JSON.stringify(record.projects || {});
  await run(`
    INSERT INTO history (date, employeeId, employeeName, activeProject, loginTime, activeTime, idleTime, breakTime, projects, isOnline, status, lastUpdated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, employeeId) DO UPDATE SET
      employeeName = excluded.employeeName,
      activeProject = excluded.activeProject,
      loginTime = excluded.loginTime,
      activeTime = excluded.activeTime,
      idleTime = excluded.idleTime,
      breakTime = excluded.breakTime,
      projects = excluded.projects,
      isOnline = excluded.isOnline,
      status = excluded.status,
      lastUpdated = excluded.lastUpdated
  `, [
    date,
    record.employeeId,
    record.employeeName,
    record.activeProject,
    record.loginTime,
    record.activeTime,
    record.idleTime,
    record.breakTime,
    projectsJson,
    record.isOnline ? 1 : 0,
    record.status,
    record.lastUpdated
  ]);
}

// Get daily records
async function getDailyRecords(date) {
  const rows = await all(`SELECT * FROM history WHERE date = ?`, [date]);
  const dayRecords = {};
  rows.forEach(r => {
    dayRecords[r.employeeId] = {
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      activeProject: r.activeProject,
      loginTime: r.loginTime,
      activeTime: r.activeTime,
      idleTime: r.idleTime,
      breakTime: r.breakTime,
      projects: JSON.parse(r.projects || '{}'),
      isOnline: r.isOnline === 1,
      status: r.status,
      lastUpdated: r.lastUpdated
    };
  });
  return dayRecords;
}

// Get all history grouped by date
async function getHistory() {
  const rows = await all(`SELECT * FROM history ORDER BY date ASC, employeeId ASC`);
  const history = {};
  rows.forEach(r => {
    if (!history[r.date]) {
      history[r.date] = {};
    }
    history[r.date][r.employeeId] = {
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      activeProject: r.activeProject,
      loginTime: r.loginTime,
      activeTime: r.activeTime,
      idleTime: r.idleTime,
      breakTime: r.breakTime,
      projects: JSON.parse(r.projects || '{}'),
      isOnline: r.isOnline === 1,
      status: r.status,
      lastUpdated: r.lastUpdated
    };
  });
  return history;
}

// Sweep stale online employees to offline
async function sweepStaleSessions(timeoutMs) {
  const now = Date.now();
  const threshold = now - timeoutMs;
  // Find sessions that are online but haven't updated recently
  const stale = await all(`SELECT date, employeeId FROM history WHERE isOnline = 1 AND lastUpdated < ?`, [threshold]);
  for (const s of stale) {
    await run(`
      UPDATE history 
      SET isOnline = 0, status = 'Offline', lastUpdated = ? 
      WHERE date = ? AND employeeId = ?
    `, [now, s.date, s.employeeId]);
  }
  return stale.length > 0;
}

// Get setting
async function getSetting(key) {
  const row = await get(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row ? row.value : null;
}

// Save setting
async function saveSetting(key, value) {
  await run(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [key, value]);
}

module.exports = {
  init,
  verifyEmployee,
  getRegistry,
  registerEmployee,
  syncRecord,
  getDailyRecords,
  getHistory,
  sweepStaleSessions,
  getSetting,
  saveSetting
};
