// Background service worker for Ethara.ai Time & Task Tracker
// Handles persistent state, delta time tracking, and tab status updates.

const DEFAULT_SETTINGS = {
  employeeName: "",
  employeeId: "",
  targetWorkHours: 6,
  targetLoginHours: 8,
  idleThresholdSeconds: 60, // 1 minute inactivity means idle
  syncUrl: "" // URL of the Admin Web Dashboard, e.g. http://localhost:3000
};

// Initial daily state structure
function getNewDailyState() {
  return {
    totalLoginTime: 0,
    totalActiveTime: 0,
    totalIdleTime: 0,
    projects: {
      "General": {
        workTime: 0,
        idleTime: 0,
        taskCount: 0
      }
    },
    activeProject: "General",
    isTracking: false,
    isActive: false,
    lastUpdated: Date.now()
  };
}

// Get YYYY-MM-DD representation
function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Check and initialize state
async function getOrInitState() {
  const data = await chrome.storage.local.get(['currentState', 'history', 'settings', 'currentDate']);
  const today = getTodayString();
  
  let state = data.currentState;
  let history = data.history || [];
  let settings = data.settings || { ...DEFAULT_SETTINGS };
  let savedDate = data.currentDate;

  // Initialize settings if empty
  if (!data.settings) {
    await chrome.storage.local.set({ settings });
  } else {
    // Migrate settings if fields missing
    let updated = false;
    for (const key in DEFAULT_SETTINGS) {
      if (settings[key] === undefined) {
        settings[key] = DEFAULT_SETTINGS[key];
        updated = true;
      }
    }
    if (updated) {
      await chrome.storage.local.set({ settings });
    }
  }

  // If date changed, archive current state to history and start new day
  if (!state || savedDate !== today) {
    if (state && savedDate) {
      // Archive
      history.push({
        date: savedDate,
        employeeName: settings.employeeName,
        employeeId: settings.employeeId,
        totalLoginTime: state.totalLoginTime,
        totalActiveTime: state.totalActiveTime,
        totalIdleTime: state.totalIdleTime,
        projects: state.projects
      });
      // Keep history to last 30 days
      if (history.length > 30) {
        history.shift();
      }
      await chrome.storage.local.set({ history });
    }

    state = getNewDailyState();
    await chrome.storage.local.set({ currentState: state, currentDate: today });
  }

  return { state, history, settings, today };
}

// Sync current metrics to the Admin Dashboard Server
async function syncToDashboard() {
  try {
    const data = await chrome.storage.local.get(['currentState', 'settings', 'currentDate']);
    if (!data.settings || !data.settings.syncUrl || !data.currentState) return;
    
    const settings = data.settings;
    const state = data.currentState;
    
    // Clean trailing slash
    const targetUrl = settings.syncUrl.replace(/\/$/, '');
    
    // Sum tasks completed today
    let totalTasks = 0;
    for (const proj in state.projects) {
      totalTasks += state.projects[proj].taskCount;
    }
    
    const payload = {
      employeeId: settings.employeeId || "N/A",
      employeeName: settings.employeeName || "Employee",
      date: data.currentDate,
      activeProject: state.activeProject || "General",
      loginTime: state.totalLoginTime,
      activeTime: state.totalActiveTime,
      idleTime: state.totalIdleTime,
      projects: state.projects,
      isOnline: state.isTracking,
      status: state.isTracking ? (state.isActive ? "Working" : "Idle") : "Offline"
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

    await fetch(`${targetUrl}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    console.debug("Ethara.ai Tracker: Sync to dashboard successful.");
  } catch (err) {
    console.debug("Ethara.ai Tracker: Dashboard sync failed:", err.message);
  }
}

// Perform timer calculations based on timestamps
async function tickTracking(forceInactive = false) {
  const { state } = await getOrInitState();
  const now = Date.now();
  const delta = now - state.lastUpdated;

  // We only increment if tracking is active
  if (state.isTracking && delta > 0) {
    state.totalLoginTime += delta;

    // Check if user is active
    const isUserActive = state.isActive && !forceInactive;

    // Active project structure safety check
    if (!state.projects[state.activeProject]) {
      state.projects[state.activeProject] = { workTime: 0, idleTime: 0, taskCount: 0 };
    }

    const proj = state.projects[state.activeProject];
    if (isUserActive) {
      state.totalActiveTime += delta;
      proj.workTime += delta;
    } else {
      state.totalIdleTime += delta;
      proj.idleTime += delta;
    }
  }

  state.lastUpdated = now;
  await chrome.storage.local.set({ currentState: state });
}

// Scan browser tabs for any Ethara.ai tab
function checkEthara.aiTabs() {
  chrome.tabs.query({ url: "*://*.multimango.com/*" }, async (tabs) => {
    const hasTab = tabs.length > 0;
    const { state } = await getOrInitState();
    
    // Check if tracking status changed
    if (state.isTracking !== hasTab) {
      // Tick once before switching status to capture final delta
      await tickTracking();
      
      state.isTracking = hasTab;
      if (!hasTab) {
        state.isActive = false; // No tab, cannot be active
      }
      state.lastUpdated = Date.now();
      await chrome.storage.local.set({ currentState: state });
      
      // Sync status change immediately
      syncToDashboard();
    }
  });
}

// Event Listeners for Tab Changes
chrome.tabs.onCreated.addListener(checkEthara.aiTabs);
chrome.tabs.onRemoved.addListener(checkEthara.aiTabs);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    checkEthara.aiTabs();
  }
});

// Listener for Window Focus to detect if browser goes background
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus completely
    setTabInactive();
  } else {
    checkEthara.aiTabs();
  }
});

async function setTabInactive() {
  const { state } = await getOrInitState();
  if (state.isActive) {
    await tickTracking(true); // tick as inactive
    state.isActive = false;
    state.lastUpdated = Date.now();
    await chrome.storage.local.set({ currentState: state });
    
    // Sync status change immediately
    syncToDashboard();
  }
}

// Listen for messages from Content Scripts and Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "HEARTBEAT") {
    handleHeartbeat(message.active, message.projectSuggestion);
    sendResponse({ success: true });
  } else if (message.type === "TASK_COMPLETED") {
    handleTaskCompleted();
    sendResponse({ success: true });
  }
  return true;
});

// Handle incoming heartbeat from content script
async function handleHeartbeat(isContentActive, projectSuggestion) {
  const { state } = await getOrInitState();
  
  // Tick using the *previous* state's activity status
  await tickTracking();

  // Update active state based on heartbeat
  state.isActive = isContentActive;
  state.isTracking = true; // Heartbeat implies a tab is open
  state.lastUpdated = Date.now();

  // If content script detected a project from the URL/Page structure, suggest it
  if (projectSuggestion && projectSuggestion !== state.activeProject) {
    if (!state.projects[projectSuggestion]) {
      state.projects[projectSuggestion] = { workTime: 0, idleTime: 0, taskCount: 0 };
    }
    if (state.activeProject === "General") {
      state.activeProject = projectSuggestion;
    }
  }

  await chrome.storage.local.set({ currentState: state });
}

// Increment task counter
async function handleTaskCompleted() {
  const { state } = await getOrInitState();
  if (!state.projects[state.activeProject]) {
    state.projects[state.activeProject] = { workTime: 0, idleTime: 0, taskCount: 0 };
  }
  state.projects[state.activeProject].taskCount += 1;
  await chrome.storage.local.set({ currentState: state });
  
  // Broadcast update to popup if open
  chrome.runtime.sendMessage({ type: "STATE_UPDATED", state }).catch(() => {});
  
  // Sync task completed immediately
  syncToDashboard();
}

// Alarm to tick calculations and sync to dashboard
chrome.alarms.create("tickTrackerAlarm", { periodInMinutes: 0.15 }); // ~10 seconds
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tickTrackerAlarm") {
    const { state } = await getOrInitState();
    if (state.isTracking) {
      await tickTracking();
    }
    // Sync to dashboard every 10 seconds (irrespective of tracking state, to keep "Offline" status fresh)
    await syncToDashboard();
  }
});

// Run check on startup
chrome.runtime.onInstalled.addListener(() => {
  getOrInitState();
  checkEthara.aiTabs();
});

chrome.runtime.onStartup.addListener(() => {
  checkEthara.aiTabs();
});
