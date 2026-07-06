// Popup script for Ethara.ai Time & Task Tracker
// Handles UI updates, live ticking, project management, settings, and CSV exports.

let currentCachedState = null;
let currentCachedSettings = null;
let uiTickIntervalId = null;

// DOM Elements
const elements = {
  // Navigation
  navBtns: document.querySelectorAll('.nav-btn'),
  tabs: document.querySelectorAll('.tab-content'),
  
  // Status
  statusPulse: document.getElementById('status-pulse'),
  statusText: document.getElementById('status-text'),
  
  // Timers & Rings
  workTimer: document.getElementById('work-timer'),
  workPercentage: document.getElementById('work-percentage'),
  workRing: document.getElementById('work-ring'),
  targetWorkVal: document.getElementById('target-work-val'),
  
  loginTimer: document.getElementById('login-timer'),
  loginPercentage: document.getElementById('login-percentage'),
  loginRing: document.getElementById('login-ring'),
  targetLoginVal: document.getElementById('target-login-val'),
  
  idleTimer: document.getElementById('idle-timer'),
  idleBarFill: document.getElementById('idle-bar-fill'),
  
  // Actions Panel
  currentProjectDisplay: document.getElementById('current-project-display'),
  taskCounter: document.getElementById('task-counter'),
  addTaskBtn: document.getElementById('add-task-btn'),
  
  // Projects Tab
  projectDropdown: document.getElementById('project-dropdown'),
  setActiveProjectBtn: document.getElementById('set-active-project-btn'),
  newProjectInput: document.getElementById('new-project-input'),
  createProjectBtn: document.getElementById('create-project-btn'),
  projectsTableBody: document.getElementById('projects-table-body'),
  
  // Settings Tab
  settingsForm: document.getElementById('settings-form'),
  employeeNameInput: document.getElementById('employee-name-input'),
  employeeIdInput: document.getElementById('employee-id-input'),
  syncUrlInput: document.getElementById('sync-url-input'),
  workTargetInput: document.getElementById('work-target-input'),
  loginTargetInput: document.getElementById('login-target-input'),
  idleThresholdInput: document.getElementById('idle-threshold-input'),
  settingsSuccessToast: document.getElementById('settings-save-success'),
  
  // Reports Tab
  exportTodayBtn: document.getElementById('export-today-btn'),
  exportAllBtn: document.getElementById('export-all-btn'),
  historyList: document.getElementById('history-list')
};

// SVG Ring Circumference = 263.89
const RING_CIRCUMFERENCE = 263.89;

// Init Popup
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  loadData();
  setupEventListeners();
  
  uiTickIntervalId = setInterval(updateUiTick, 1000);
});

// Setup Navigation Tabs
function setupTabs() {
  elements.navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.navBtns.forEach(b => b.classList.remove('active'));
      elements.tabs.forEach(t => t.classList.remove('active'));
      
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      const targetTab = document.getElementById(tabId);
      if (targetTab) {
        targetTab.classList.add('active');
      }

      // Special tab initializations
      if (tabId === 'projects-tab') {
        renderProjectsTab();
      } else if (tabId === 'settings-tab') {
        populateSettingsForm();
      } else if (tabId === 'reports-tab') {
        renderReportsTab();
      }
    });
  });
}

// Fetch State and Settings from chrome.storage
async function loadData() {
  const data = await chrome.storage.local.get(['currentState', 'settings', 'history']);
  
  if (data.currentState) {
    currentCachedState = data.currentState;
  }
  
  if (data.settings) {
    currentCachedSettings = data.settings;
    elements.targetWorkVal.textContent = `${currentCachedSettings.targetWorkHours}h`;
    elements.targetLoginVal.textContent = `${currentCachedSettings.targetLoginHours}h`;
  }
  
  updateDashboardUi();
  populateProjectDropdown();
}

// Setup Interaction Event Listeners
function setupEventListeners() {
  // Manual Task Adder
  elements.addTaskBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: "TASK_COMPLETED" }, (response) => {
      loadData();
    });
  });

  // Switch Active Project
  elements.setActiveProjectBtn.addEventListener('click', async () => {
    const selectedProj = elements.projectDropdown.value;
    if (selectedProj && currentCachedState) {
      currentCachedState.activeProject = selectedProj;
      await chrome.storage.local.set({ currentState: currentCachedState });
      elements.currentProjectDisplay.textContent = selectedProj;
      renderProjectsTab();
    }
  });

  // Create Project
  elements.createProjectBtn.addEventListener('click', async () => {
    const name = elements.newProjectInput.value.trim();
    if (!name) return;
    
    if (currentCachedState) {
      if (!currentCachedState.projects[name]) {
        currentCachedState.projects[name] = { workTime: 0, idleTime: 0, taskCount: 0 };
        currentCachedState.activeProject = name;
        await chrome.storage.local.set({ currentState: currentCachedState });
        
        elements.newProjectInput.value = '';
        elements.currentProjectDisplay.textContent = name;
        
        populateProjectDropdown();
        renderProjectsTab();
      }
    }
  });

  // Settings Save
  elements.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const newSettings = {
      employeeName: elements.employeeNameInput.value.trim(),
      employeeId: elements.employeeIdInput.value.trim(),
      syncUrl: elements.syncUrlInput.value.trim(),
      targetWorkHours: parseFloat(elements.workTargetInput.value) || 6,
      targetLoginHours: parseFloat(elements.loginTargetInput.value) || 8,
      idleThresholdSeconds: parseInt(elements.idleThresholdInput.value) || 60
    };

    currentCachedSettings = newSettings;
    await chrome.storage.local.set({ settings: newSettings });

    elements.targetWorkVal.textContent = `${newSettings.targetWorkHours}h`;
    elements.targetLoginVal.textContent = `${newSettings.targetLoginHours}h`;

    // Show success toast
    elements.settingsSuccessToast.classList.add('show');
    setTimeout(() => {
      elements.settingsSuccessToast.classList.remove('show');
    }, 2000);
  });

  // CSV Exports
  elements.exportTodayBtn.addEventListener('click', () => exportCSVReport(true));
  elements.exportAllBtn.addEventListener('click', () => exportCSVReport(false));

  // Receive message updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "STATE_UPDATED") {
      currentCachedState = message.state;
      updateDashboardUi();
    }
  });
}

// Convert Milliseconds to HH:MM:SS format
function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSecs = Math.floor(ms / 1000);
  const hrs = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
  const mins = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
  const secs = String(totalSecs % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

// UI Ticker running every second to display smooth countdown/progress
function updateUiTick() {
  if (!currentCachedState || !currentCachedState.isTracking) return;

  const now = Date.now();
  const elapsed = now - currentCachedState.lastUpdated;

  if (elapsed <= 0) return;

  const stateCopy = JSON.parse(JSON.stringify(currentCachedState));
  stateCopy.totalLoginTime += elapsed;
  
  const activeProj = stateCopy.activeProject;
  if (!stateCopy.projects[activeProj]) {
    stateCopy.projects[activeProj] = { workTime: 0, idleTime: 0, taskCount: 0 };
  }
  
  if (stateCopy.isActive) {
    stateCopy.totalActiveTime += elapsed;
    stateCopy.projects[activeProj].workTime += elapsed;
  } else {
    stateCopy.totalIdleTime += elapsed;
    stateCopy.projects[activeProj].idleTime += elapsed;
  }

  renderTimers(stateCopy);
}

// Render Dashboard values
function updateDashboardUi() {
  if (!currentCachedState) return;

  if (currentCachedState.isTracking) {
    if (currentCachedState.isActive) {
      elements.statusPulse.className = "status-pulse active";
      elements.statusText.textContent = "Working";
    } else {
      elements.statusPulse.className = "status-pulse idle";
      elements.statusText.textContent = "Idle";
    }
  } else {
    elements.statusPulse.className = "status-pulse offline";
    elements.statusText.textContent = "Inactive";
  }

  elements.currentProjectDisplay.textContent = currentCachedState.activeProject;
  
  let totalTasks = 0;
  for (const proj in currentCachedState.projects) {
    totalTasks += currentCachedState.projects[proj].taskCount;
  }
  elements.taskCounter.textContent = totalTasks;

  renderTimers(currentCachedState);
}

// Render Timers, Progress Bars, and SVG Rings
function renderTimers(state) {
  elements.workTimer.textContent = formatTime(state.totalActiveTime);
  elements.loginTimer.textContent = formatTime(state.totalLoginTime);
  elements.idleTimer.textContent = formatTime(state.totalIdleTime);

  const workTargetMs = (currentCachedSettings ? currentCachedSettings.targetWorkHours : 6) * 3600000;
  const loginTargetMs = (currentCachedSettings ? currentCachedSettings.targetLoginHours : 8) * 3600000;

  const workPct = Math.min(Math.round((state.totalActiveTime / workTargetMs) * 100), 100);
  elements.workPercentage.textContent = `${workPct}%`;
  const workOffset = RING_CIRCUMFERENCE - (workPct / 100) * RING_CIRCUMFERENCE;
  elements.workRing.style.strokeDashoffset = workOffset;

  const loginPct = Math.min(Math.round((state.totalLoginTime / loginTargetMs) * 100), 100);
  elements.loginPercentage.textContent = `${loginPct}%`;
  const loginOffset = RING_CIRCUMFERENCE - (loginPct / 100) * RING_CIRCUMFERENCE;
  elements.loginRing.style.strokeDashoffset = loginOffset;

  const idlePct = state.totalLoginTime > 0 
    ? Math.min(Math.round((state.totalIdleTime / state.totalLoginTime) * 100), 100) 
    : 0;
  elements.idleBarFill.style.width = `${idlePct}%`;
}

// Populate Project selector dropdown
function populateProjectDropdown() {
  if (!currentCachedState) return;
  
  elements.projectDropdown.innerHTML = '';
  for (const name in currentCachedState.projects) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === currentCachedState.activeProject) {
      opt.selected = true;
    }
    elements.projectDropdown.appendChild(opt);
  }
}

// Render Project statistics table
function renderProjectsTab() {
  if (!currentCachedState) return;
  
  elements.projectsTableBody.innerHTML = '';
  
  for (const name in currentCachedState.projects) {
    const proj = currentCachedState.projects[name];
    const tr = document.createElement('tr');
    
    if (name === currentCachedState.activeProject) {
      tr.classList.add('active-row');
    }
    
    const tdName = document.createElement('td');
    tdName.innerHTML = name === currentCachedState.activeProject 
      ? `<strong>${name} 🥭</strong>` 
      : name;
      
    const tdWork = document.createElement('td');
    tdWork.textContent = formatTime(proj.workTime);
    
    const tdIdle = document.createElement('td');
    tdIdle.textContent = formatTime(proj.idleTime);
    
    const tdTasks = document.createElement('td');
    tdTasks.textContent = proj.taskCount;
    
    tr.appendChild(tdName);
    tr.appendChild(tdWork);
    tr.appendChild(tdIdle);
    tr.appendChild(tdTasks);
    
    elements.projectsTableBody.appendChild(tr);
  }
}

// Populates form elements on Settings view
function populateSettingsForm() {
  if (!currentCachedSettings) return;
  
  elements.employeeNameInput.value = currentCachedSettings.employeeName;
  elements.employeeIdInput.value = currentCachedSettings.employeeId;
  elements.syncUrlInput.value = currentCachedSettings.syncUrl || "";
  elements.workTargetInput.value = currentCachedSettings.targetWorkHours;
  elements.loginTargetInput.value = currentCachedSettings.targetLoginHours;
  elements.idleThresholdInput.value = currentCachedSettings.idleThresholdSeconds;
}

// Render Reports Tab
async function renderReportsTab() {
  const data = await chrome.storage.local.get(['history']);
  const history = data.history || [];
  
  elements.historyList.innerHTML = '';
  
  if (history.length === 0) {
    elements.historyList.innerHTML = '<div class="history-placeholder">No history logged yet.</div>';
    return;
  }

  history.slice().reverse().forEach(day => {
    const item = document.createElement('div');
    item.className = 'history-item';
    
    const dateDiv = document.createElement('div');
    dateDiv.className = 'history-item-date';
    dateDiv.textContent = formatDateString(day.date);
    
    const statsDiv = document.createElement('div');
    statsDiv.className = 'history-item-stats';
    
    let dayTasks = 0;
    for (const p in day.projects) {
      dayTasks += day.projects[p].taskCount;
    }

    statsDiv.innerHTML = `
      <span class="small-timer" style="color: #60a5fa">Work: ${formatTime(day.totalActiveTime)}</span>
      <div class="history-item-details">Login: ${formatTime(day.totalLoginTime)} • Tasks: ${dayTasks}</div>
    `;
    
    item.appendChild(dateDiv);
    item.appendChild(statsDiv);
    elements.historyList.appendChild(item);
  });
}

function formatDateString(dateStr) {
  const [year, month, day] = dateStr.split('-');
  const dateObj = new Date(year, month - 1, day);
  return dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// CSV Export Logic
async function exportCSVReport(todayOnly = true) {
  const data = await chrome.storage.local.get(['currentState', 'history', 'settings', 'currentDate']);
  const settings = data.settings || { employeeName: "Employee", employeeId: "N/A" };
  const name = settings.employeeName || "Employee";
  const empId = settings.employeeId || "N/A";
  
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Date,Employee Name,Employee ID,Project Name,Active Work Duration (HH:MM:SS),Idle Duration (HH:MM:SS),Login/Session Duration (HH:MM:SS),Tasks Completed,Work Target Met,Login Target Met\r\n";
  
  const targetWorkMs = (settings.targetWorkHours || 6) * 3600000;
  const targetLoginMs = (settings.targetLoginHours || 8) * 3600000;
  const recordsToExport = [];

  if (data.currentState && data.currentDate) {
    recordsToExport.push({
      date: data.currentDate,
      totalActiveTime: data.currentState.totalActiveTime,
      totalIdleTime: data.currentState.totalIdleTime,
      totalLoginTime: data.currentState.totalLoginTime,
      projects: data.currentState.projects
    });
  }

  if (!todayOnly && data.history) {
    data.history.forEach(day => {
      if (day.date !== data.currentDate) {
        recordsToExport.push(day);
      }
    });
  }

  recordsToExport.sort((a, b) => b.date.localeCompare(a.date));
  
  recordsToExport.forEach(record => {
    const isWorkMet = record.totalActiveTime >= targetWorkMs ? "YES" : "NO";
    const isLoginMet = record.totalLoginTime >= targetLoginMs ? "YES" : "NO";

    csvContent += `${record.date},${name},${empId},[GLOBAL SUMMARY],${formatTime(record.totalActiveTime)},${formatTime(record.totalIdleTime)},${formatTime(record.totalLoginTime)},${sumTasks(record.projects)},${isWorkMet},${isLoginMet}\r\n`;

    for (const projName in record.projects) {
      const proj = record.projects[projName];
      csvContent += `${record.date},${name},${empId},${projName},${formatTime(proj.workTime)},${formatTime(proj.idleTime)},-,${proj.taskCount},-,- \r\n`;
    }
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  const filename = todayOnly 
    ? `ethara_report_today_${data.currentDate || 'log'}.csv`
    : `ethara_report_history_${data.currentDate || 'log'}.csv`;

  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function sumTasks(projects) {
  let count = 0;
  for (const p in projects) {
    count += projects[p].taskCount;
  }
  return count;
}
