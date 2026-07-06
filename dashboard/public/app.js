// Admin Portal Script
// Coordinates real-time fetches, dashboard rendering, date selection, and reports.

let activeView = 'live-view';
let liveFetchIntervalId = null;
let selectedDate = getTodayString();
let historicalDataCache = {};

// Targets
const WORK_TARGET_MS = 6 * 3600000;  // 6 hours
const LOGIN_TARGET_MS = 8 * 3600000; // 8 hours

document.addEventListener('DOMContentLoaded', () => {
  setupSidebar();
  setupDatePicker();
  setupEventListeners();
  setupSapImport();
  loadGoogleSheetSettings();
  
  // Initial load
  selectedDate = getTodayString();
  elements.datePicker.value = selectedDate;
  
  fetchDashboardData();
  startLiveFetching();
});

const elements = {
  menuItems: document.querySelectorAll('.menu-item'),
  views: document.querySelectorAll('.view-content'),
  datePicker: document.getElementById('dashboard-date-picker'),
  refreshBtn: document.getElementById('refresh-btn'),
  currentDateLbl: document.getElementById('current-date-lbl'),
  
  // Summary widgets
  activeCountVal: document.getElementById('active-count-val'),
  totalWorkVal: document.getElementById('total-work-val'),
  totalTasksVal: document.getElementById('total-tasks-val'),
  avgIdleVal: document.getElementById('avg-idle-val'),
  
  // Lists
  employeesGrid: document.getElementById('employees-grid'),
  employeesTableBody: document.getElementById('employees-table-body'),
  historyTableBody: document.getElementById('history-table-body'),
  
  // Actions
  exportTodayBtn: document.getElementById('export-today-btn'),
  exportHistoryBtn: document.getElementById('export-history-btn'),

  // SAP Elements
  uploadZone: document.getElementById('upload-zone'),
  sapFileInput: document.getElementById('sap-file-input'),
  sapMappingPanel: document.getElementById('sap-mapping-panel'),
  sapColEmpId: document.getElementById('sap-col-empid'),
  sapColDate: document.getElementById('sap-col-date'),
  sapColHours: document.getElementById('sap-col-hours'),
  processSapBtn: document.getElementById('process-sap-btn'),
  sapResultsCard: document.getElementById('sap-results-card'),
  sapComparisonTableBody: document.getElementById('sap-comparison-table-body'),

  // Google Sheets integration elements
  googleSheetWebhookInput: document.getElementById('google-sheet-webhook-input'),
  saveSheetWebhookBtn: document.getElementById('save-sheet-webhook-btn'),
  webhookToast: document.getElementById('webhook-toast')
};

// Setup Sidebar navigation
function setupSidebar() {
  elements.menuItems.forEach(item => {
    item.addEventListener('click', () => {
      elements.menuItems.forEach(i => i.classList.remove('active'));
      elements.views.forEach(v => v.classList.remove('active'));
      
      item.classList.add('active');
      activeView = item.getAttribute('data-view');
      document.getElementById(activeView).classList.add('active');
      
      if (activeView === 'reports-view') {
        fetchHistoryReport();
        loadGoogleSheetSettings();
      }
    });
  });
}

// Setup Date Picker
function setupDatePicker() {
  elements.datePicker.addEventListener('change', (e) => {
    selectedDate = e.target.value;
    const today = getTodayString();
    
    if (selectedDate === today) {
      elements.currentDateLbl.textContent = 'Live Monitoring';
      startLiveFetching();
    } else {
      elements.currentDateLbl.textContent = `Inspecting Date: ${selectedDate}`;
      stopLiveFetching();
    }
    fetchDashboardData();
  });
}

// Action Button Listeners
function setupEventListeners() {
  elements.refreshBtn.addEventListener('click', () => {
    fetchDashboardData();
    if (activeView === 'reports-view') {
      fetchHistoryReport();
    }
  });

  elements.exportTodayBtn.addEventListener('click', () => exportTodayCSV());
  elements.exportHistoryBtn.addEventListener('click', () => exportFullHistoryCSV());

  // Save Google Sheet Webhook
  elements.saveSheetWebhookBtn.addEventListener('click', saveGoogleSheetSettings);
}

// Live Update Triggers
function startLiveFetching() {
  stopLiveFetching();
  liveFetchIntervalId = setInterval(fetchDashboardData, 5000); // refresh every 5 seconds
}

function stopLiveFetching() {
  if (liveFetchIntervalId) {
    clearInterval(liveFetchIntervalId);
    liveFetchIntervalId = null;
  }
}

// Helper: YYYY-MM-DD
function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Helper: formats Milliseconds to HH:MM:SS
function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSecs = Math.floor(ms / 1000);
  const hrs = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
  const mins = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
  const secs = String(totalSecs % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

// Fetch Employees Data from Express Server
async function fetchDashboardData() {
  try {
    const res = await fetch(`/api/employees?date=${selectedDate}`);
    if (!res.ok) throw new Error('Network error fetching employees data');
    const employees = await res.json();
    
    renderDashboard(employees);
  } catch (err) {
    console.error('Error fetching dashboard metrics:', err.message);
  }
}

// Render Dashboard components
function renderDashboard(employees) {
  const employeeList = Object.values(employees);
  
  // 1. Calculate Summary Metrics
  let activeCount = 0;
  let totalWorkMs = 0;
  let totalTasks = 0;
  let sumIdleMs = 0;
  let sumLoginMs = 0;
  
  employeeList.forEach(emp => {
    if (emp.isOnline) activeCount++;
    totalWorkMs += emp.activeTime;
    sumIdleMs += emp.idleTime;
    sumLoginMs += emp.loginTime;
    
    // Sum tasks from projects
    for (const p in emp.projects) {
      totalTasks += emp.projects[p].taskCount;
    }
  });

  const avgIdlePct = sumLoginMs > 0 ? Math.round((sumIdleMs / sumLoginMs) * 100) : 0;
  
  elements.activeCountVal.textContent = activeCount;
  elements.totalWorkVal.textContent = formatTime(totalWorkMs);
  elements.totalTasksVal.textContent = totalTasks;
  elements.avgIdleVal.textContent = `${avgIdlePct}%`;

  // 2. Render Cards Grid
  elements.employeesGrid.innerHTML = '';
  if (employeeList.length === 0) {
    elements.employeesGrid.innerHTML = '<div class="grid-placeholder">No employees synced on this date.</div>';
  } else {
    employeeList.forEach(emp => {
      elements.employeesGrid.appendChild(createEmployeeCard(emp));
    });
  }

  // 3. Render Table rows
  elements.employeesTableBody.innerHTML = '';
  if (employeeList.length === 0) {
    elements.employeesTableBody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-dimmed);">No records logged.</td></tr>';
  } else {
    employeeList.forEach(emp => {
      elements.employeesTableBody.appendChild(createEmployeeRow(emp));
    });
  }
}

// HTML Generator: Employee Card
function createEmployeeCard(emp) {
  const card = document.createElement('div');
  card.className = 'employee-card';
  
  const statusClass = emp.status.toLowerCase();
  
  // Sum tasks
  let tasks = 0;
  for (const p in emp.projects) {
    tasks += emp.projects[p].taskCount;
  }
  
  const workPct = Math.min(Math.round((emp.activeTime / WORK_TARGET_MS) * 100), 100);
  const loginPct = Math.min(Math.round((emp.loginTime / LOGIN_TARGET_MS) * 100), 100);

  card.innerHTML = `
    <div class="card-header">
      <div class="employee-details">
        <h3>${emp.employeeName}</h3>
        <span>ID: ${emp.employeeId}</span>
      </div>
      <span class="status-pill ${statusClass}">${emp.status}</span>
    </div>
    
    <div class="card-project-section">
      <span class="project-lbl">Active Project</span>
      <span class="project-val">${emp.activeProject}</span>
    </div>
    
    <div class="card-progress-section">
      <div class="progress-group">
        <div class="progress-lbls">
          <span>Active Work Target</span>
          <strong>${formatTime(emp.activeTime)} / 6h (${workPct}%)</strong>
        </div>
        <div class="progress-bg">
          <div class="progress-fill work" style="width: ${workPct}%"></div>
        </div>
      </div>
      
      <div class="progress-group">
        <div class="progress-lbls">
          <span>Login / Session</span>
          <strong>${formatTime(emp.loginTime)} / 8h (${loginPct}%)</strong>
        </div>
        <div class="progress-bg">
          <div class="progress-fill login" style="width: ${loginPct}%"></div>
        </div>
      </div>
    </div>
    
    <div class="card-footer-stats">
      <span>Idle Time: <strong style="color: var(--color-idle)">${formatTime(emp.idleTime)}</strong></span>
      <span>Tasks: <span class="task-badge">${tasks}</span></span>
    </div>
  `;
  return card;
}

// HTML Generator: Employee Table Row
function createEmployeeRow(emp) {
  const tr = document.createElement('tr');
  const statusClass = emp.status.toLowerCase();
  
  let tasks = 0;
  for (const p in emp.projects) {
    tasks += emp.projects[p].taskCount;
  }

  const complianceMet = (emp.activeTime >= WORK_TARGET_MS) && (emp.loginTime >= LOGIN_TARGET_MS);
  const compTag = complianceMet 
    ? '<span class="compliance-tag met">MET</span>'
    : '<span class="compliance-tag not-met">PENDING</span>';

  tr.innerHTML = `
    <td>
      <strong style="color: var(--text-main); font-size: 14px;">${emp.employeeName}</strong>
      <div style="font-size: 11px; color: var(--text-muted);">ID: ${emp.employeeId}</div>
    </td>
    <td><span class="status-pill ${statusClass}">${emp.status}</span></td>
    <td><span style="color: var(--color-work); font-weight: 600;">${emp.activeProject}</span></td>
    <td>${formatTime(emp.loginTime)}</td>
    <td>${formatTime(emp.activeTime)}</td>
    <td>${formatTime(emp.idleTime)}</td>
    <td><strong>${tasks}</strong></td>
    <td>${compTag}</td>
  `;
  return tr;
}

// Fetch Historical Report Summaries
async function fetchHistoryReport() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) throw new Error('Failed to fetch full history');
    const history = await res.json();
    historicalDataCache = history;
    
    renderHistoryTable(history);
  } catch (err) {
    console.error('Error fetching historical reports:', err.message);
  }
}

// Render Historical Summary Table
function renderHistoryTable(history) {
  elements.historyTableBody.innerHTML = '';
  const dates = Object.keys(history).sort((a, b) => b.localeCompare(a)); // sorted newest first

  if (dates.length === 0) {
    elements.historyTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-dimmed);">No history saved yet.</td></tr>';
    return;
  }

  dates.forEach(date => {
    const employees = Object.values(history[date]);
    const numEmployees = employees.length;
    
    let totalWorkMs = 0;
    let totalTasks = 0;
    let totalIdleMs = 0;
    let totalLoginMs = 0;

    employees.forEach(emp => {
      totalWorkMs += emp.activeTime;
      totalIdleMs += emp.idleTime;
      totalLoginMs += emp.loginTime;
      
      for (const p in emp.projects) {
        totalTasks += emp.projects[p].taskCount;
      }
    });

    const avgIdlePct = totalLoginMs > 0 ? Math.round((totalIdleMs / totalLoginMs) * 100) : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${date}</strong></td>
      <td>${numEmployees} employees</td>
      <td>${formatTime(totalWorkMs)}</td>
      <td><strong>${totalTasks}</strong></td>
      <td><span style="color: var(--color-idle)">${avgIdlePct}%</span></td>
    `;
    elements.historyTableBody.appendChild(tr);
  });
}

// Helper: Formats time value into decimal hours
function formatHours(ms) {
  return (ms / 3600000).toFixed(2);
}

// Export Today's CSV client-side
async function exportTodayCSV() {
  try {
    const res = await fetch(`/api/employees?date=${selectedDate}`);
    const employees = await res.json();
    const list = Object.values(employees);
    
    if (list.length === 0) {
      alert("No data to export on this date!");
      return;
    }

    let csv = "Date,Employee Name,Employee ID,Active Project,Work Hours,Idle Hours,Login Hours,Tasks Completed,Work Target Met,Login Target Met\r\n";
    
    list.forEach(emp => {
      let tasks = 0;
      for (const p in emp.projects) {
        tasks += emp.projects[p].taskCount;
      }
      const workMet = emp.activeTime >= WORK_TARGET_MS ? "YES" : "NO";
      const loginMet = emp.loginTime >= LOGIN_TARGET_MS ? "YES" : "NO";
      
      csv += `${selectedDate},"${emp.employeeName}",${emp.employeeId},"${emp.activeProject}",${formatHours(emp.activeTime)},${formatHours(emp.idleTime)},${formatHours(emp.loginTime)},${tasks},${workMet},${loginMet}\r\n`;
    });

    downloadCSV(csv, `ethara_team_report_${selectedDate}.csv`);
  } catch (err) {
    alert("Export failed: " + err.message);
  }
}

// Export Full History CSV client-side
async function exportFullHistoryCSV() {
  try {
    const res = await fetch('/api/history');
    const history = await res.json();
    const dates = Object.keys(history).sort();

    if (dates.length === 0) {
      alert("No history data to export!");
      return;
    }

    let csv = "Date,Employee Name,Employee ID,Active Project,Work Hours,Idle Hours,Login Hours,Tasks Completed,Work Target Met,Login Target Met\r\n";
    
    dates.forEach(date => {
      const list = Object.values(history[date]);
      list.forEach(emp => {
        let tasks = 0;
        for (const p in emp.projects) {
          tasks += emp.projects[p].taskCount;
        }
        const workMet = emp.activeTime >= WORK_TARGET_MS ? "YES" : "NO";
        const loginMet = emp.loginTime >= LOGIN_TARGET_MS ? "YES" : "NO";
        
        csv += `${date},"${emp.employeeName}",${emp.employeeId},"${emp.activeProject}",${formatHours(emp.activeTime)},${formatHours(emp.idleTime)},${formatHours(emp.loginTime)},${tasks},${workMet},${loginMet}\r\n`;
      });
    });

    downloadCSV(csv, "ethara_team_history_report.csv");
  } catch (err) {
    alert("Export failed: " + err.message);
  }
}

// Trigger browser download
function downloadCSV(csvText, filename) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================
// SAP CSV IMPORT & COMPARISON ENGINE
// ==========================================

let parsedSapHeaders = [];
let parsedSapRows = [];

function setupSapImport() {
  if (!elements.uploadZone) return;

  // Click zone to browse
  elements.uploadZone.addEventListener('click', () => {
    elements.sapFileInput.click();
  });

  // File input change
  elements.sapFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleSapFile(file);
  });

  // Drag & drop handlers
  elements.uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.uploadZone.classList.add('dragover');
  });

  elements.uploadZone.addEventListener('dragleave', () => {
    elements.uploadZone.classList.remove('dragover');
  });

  elements.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleSapFile(file);
  });

  // Compare action button
  elements.processSapBtn.addEventListener('click', processSapComparison);
}

// Parse CSV file content
function handleSapFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    
    // Parse CSV rows, removing empty rows and surrounding quotes
    const rows = text.split(/\r?\n/)
      .map(row => row.trim())
      .filter(row => row.length > 0)
      .map(row => {
        // Parse CSV columns, respecting quotes
        return row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
          .map(cell => cell.replace(/^["']|["']$/g, '').trim());
      });

    if (rows.length < 2) {
      alert("CSV file must contain at least a header row and one data row!");
      return;
    }

    parsedSapHeaders = rows[0];
    parsedSapRows = rows.slice(1);

    // Populate dropdown fields
    populateMappingSelects(parsedSapHeaders);
    elements.sapMappingPanel.style.display = 'block';
    
    // Smooth scroll to mapping panel
    elements.sapMappingPanel.scrollIntoView({ behavior: 'smooth' });
  };
  
  reader.readAsText(file);
}

// Populate column selectors and attempt auto-selection
function populateMappingSelects(headers) {
  const selects = [elements.sapColEmpId, elements.sapColDate, elements.sapColHours];
  
  selects.forEach(sel => {
    sel.innerHTML = '';
    headers.forEach((header, index) => {
      const opt = document.createElement('option');
      opt.value = index;
      opt.textContent = `${header} (Col ${index + 1})`;
      sel.appendChild(opt);
    });
  });

  // Auto-detection logic based on headers names
  headers.forEach((header, index) => {
    const norm = header.toLowerCase();
    if (norm.includes('id') || norm.includes('emp') || norm.includes('code') || norm.includes('user')) {
      elements.sapColEmpId.value = index;
    }
    if (norm.includes('date') || norm.includes('day') || norm.includes('timecard')) {
      elements.sapColDate.value = index;
    }
    if (norm.includes('hour') || norm.includes('dur') || norm.includes('work') || norm.includes('logged') || norm.includes('login')) {
      elements.sapColHours.value = index;
    }
  });
}

// Date Normalizer: Converts MM/DD/YYYY, DD-MM-YYYY, etc. to YYYY-MM-DD
function normalizeDate(dateStr) {
  let clean = dateStr.replace(/[-\/.]/g, '-'); // replace dividers with dash
  const parts = clean.split('-');

  if (parts.length !== 3) return dateStr;

  // YYYY-MM-DD
  if (parts[0].length === 4) {
    return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }

  // DD-MM-YYYY or MM-DD-YYYY
  if (parts[2].length === 4) {
    // We assume standard US date format MM-DD-YYYY if MM <= 12, or just standard local.
    // To be safe, if parts[0] > 12, it is DD-MM-YYYY.
    const p0 = parseInt(parts[0]);
    const p1 = parseInt(parts[1]);
    
    if (p0 > 12) {
      // DD-MM-YYYY
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    } else {
      // MM-DD-YYYY (standard default)
      return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
    }
  }

  return dateStr;
}

// Parse duration to hours float (supports float like 8.5 or string format HH:MM:SS)
function parseDurationToHours(val) {
  if (val.includes(':')) {
    const parts = val.split(':').map(p => parseFloat(p) || 0);
    if (parts.length === 3) {
      return parts[0] + (parts[1] / 60) + (parts[2] / 3600);
    } else if (parts.length === 2) {
      return parts[0] + (parts[1] / 60);
    }
  }
  return parseFloat(val) || 0;
}

// Perform Comparison and display discrepancy report
async function processSapComparison() {
  const empIdx = parseInt(elements.sapColEmpId.value);
  const dateIdx = parseInt(elements.sapColDate.value);
  const hoursIdx = parseInt(elements.sapColHours.value);

  if (isNaN(empIdx) || isNaN(dateIdx) || isNaN(hoursIdx)) {
    alert("Please select mappings for all required fields first.");
    return;
  }

  try {
    // 1. Fetch entire history from server database to compare in memory
    const res = await fetch('/api/history');
    if (!res.ok) throw new Error("Failed to retrieve historical tracking logs");
    const history = await res.json();

    // 2. Parse SAP log rows
    const sapRecords = [];
    parsedSapRows.forEach((row, rowIndex) => {
      const empId = row[empIdx];
      const rawDate = row[dateIdx];
      const rawHours = row[hoursIdx];

      if (!empId || !rawDate || !rawHours) return;

      const date = normalizeDate(empId.includes('-') && rawDate.includes('-') ? rawDate : rawDate.trim());
      const sapHours = parseDurationToHours(rawHours);

      sapRecords.push({
        rowIndex: rowIndex + 2,
        employeeId: empId.trim(),
        date: date,
        sapHours: sapHours
      });
    });

    // 3. Process comparison list
    elements.sapComparisonTableBody.innerHTML = '';
    
    if (sapRecords.length === 0) {
      elements.sapComparisonTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-dimmed);">No valid data rows found in CSV.</td></tr>';
      elements.sapResultsCard.style.display = 'block';
      return;
    }

    sapRecords.forEach(rec => {
      const dateRecords = history[rec.date] || {};
      const empTracked = dateRecords[rec.employeeId];

      let trackedHours = 0;
      let employeeName = "Not Tracked";
      
      if (empTracked) {
        trackedHours = empTracked.loginTime / 3600000; // convert milliseconds to decimal hours
        employeeName = empTracked.employeeName;
      }

      const variance = trackedHours - rec.sapHours;
      const absVariance = Math.abs(variance);

      // Status logic: Match if discrepancy is within 15 minutes (0.25 hrs)
      let status = "";
      let statusClass = "";
      let varianceClass = "";

      if (trackedHours === 0) {
        status = "NO TRACKING RECORD";
        statusClass = "status-pill offline";
        varianceClass = "variance-cell neutral";
      } else if (variance < -0.25) {
        status = "UNDER-TRACKED";
        statusClass = "status-pill idle";
        varianceClass = "variance-cell negative";
      } else if (variance > 0.25) {
        status = "OVER-TRACKED";
        statusClass = "status-pill working";
        varianceClass = "variance-cell positive";
      } else {
        status = "MATCH";
        statusClass = "status-pill working";
        varianceClass = "variance-cell positive";
      }

      // Render Row
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${rec.date}</strong></td>
        <td>${rec.employeeId}</td>
        <td>${employeeName}</td>
        <td><strong>${trackedHours.toFixed(2)}h</strong></td>
        <td><strong>${rec.sapHours.toFixed(2)}h</strong></td>
        <td class="${varianceClass}">${variance >= 0 ? '+' : ''}${variance.toFixed(2)}h</td>
        <td><span class="${statusClass}">${status}</span></td>
      `;
      elements.sapComparisonTableBody.appendChild(tr);
    });

    elements.sapResultsCard.style.display = 'block';
    
    // Smooth scroll to comparison report card
    elements.sapResultsCard.scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    alert("Comparison failed: " + err.message);
  }
}

// Fetch Google Sheet webhook URL settings
async function loadGoogleSheetSettings() {
  if (!elements.googleSheetWebhookInput) return;
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      elements.googleSheetWebhookInput.value = data.googleSheetsWebhookUrl || "";
    }
  } catch (err) {
    console.error("Failed to load Google Sheets settings:", err.message);
  }
}

// Save Google Sheet Webhook URL settings
async function saveGoogleSheetSettings() {
  const url = elements.googleSheetWebhookInput.value.trim();
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleSheetsWebhookUrl: url })
    });
    if (res.ok) {
      elements.webhookToast.style.display = 'block';
      setTimeout(() => {
        elements.webhookToast.style.display = 'none';
      }, 3000);
    } else {
      throw new Error("Server rejected settings save");
    }
  } catch (err) {
    alert("Failed to save webhook link: " + err.message);
  }
}

