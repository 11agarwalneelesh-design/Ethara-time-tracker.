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
    totalBreakTime: 0,
    projects: {
      "General": {
        workTime: 0,
        idleTime: 0,
        breakTime: 0,
        taskCount: 0
      }
    },
    activeProject: "General",
    isLoggedIn: false, // Whether the user clicked "Login"
    isOnBreak: false,  // Whether the user is on break
    isTracking: false, // Whether the MultiMango tab is open
    isActive: false,   // Whether the tab is actively focused
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
        totalBreakTime: state.totalBreakTime || 0,
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
    
    const payload = {
      employeeId: settings.employeeId || "N/A",
      employeeName: settings.employeeName || "Employee",
      date: data.currentDate,
      activeProject: state.activeProject || "General",
      loginTime: state.totalLoginTime,
      activeTime: state.totalActiveTime,
      idleTime: state.totalIdleTime,
      breakTime: state.totalBreakTime || 0,
      projects: state.projects,
      isOnline: state.isLoggedIn, // Online on dashboard if logged in
      status: state.isLoggedIn 
        ? (state.isOnBreak 
            ? "Break" 
            : (state.isTracking && state.isActive ? "Working" : "Idle"))
        : "Offline"
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

  // We only increment if logged in manually
  if (state.isLoggedIn && delta > 0) {
    state.totalLoginTime += delta;

    // Active project structure safety check
    if (!state.projects[state.activeProject]) {
      state.projects[state.activeProject] = { workTime: 0, idleTime: 0, breakTime: 0, taskCount: 0 };
    }

    const proj = state.projects[state.activeProject];
    if (proj.breakTime === undefined) proj.breakTime = 0;

    if (state.isOnBreak) {
      // User is on break: accumulate breakTime
      state.totalBreakTime = (state.totalBreakTime || 0) + delta;
      proj.breakTime += delta;
    } else {
      // User is active: check active tab focus on MultiMango
      const isUserActive = state.isActive && !forceInactive;
      if (isUserActive) {
        state.totalActiveTime += delta;
        proj.workTime += delta;
      } else {
        state.totalIdleTime += delta;
        proj.idleTime += delta;
      }
    }
  }

  state.lastUpdated = now;
  await chrome.storage.local.set({ currentState: state });
}

// Scan browser tabs for any MultiMango tab
function checkTrackingTabs() {
  chrome.tabs.query({ url: "*://*.multimango.com/*" }, async (tabs) => {
    const hasTab = tabs.length > 0;
    const { state } = await getOrInitState();
    
    // Check if tracking status changed
    if (state.isTracking !== hasTab) {
      if (state.isLoggedIn) {
        // Tick once before switching status to capture final delta
        await tickTracking();
      }
      
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
chrome.tabs.onCreated.addListener(checkTrackingTabs);
chrome.tabs.onRemoved.addListener(checkTrackingTabs);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    checkTrackingTabs();
  }
});

// Listener for Window Focus to detect if browser goes background
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus completely
    setTabInactive();
  } else {
    checkTrackingTabs();
  }
});

async function setTabInactive() {
  const { state } = await getOrInitState();
  if (state.isActive) {
    if (state.isLoggedIn) {
      await tickTracking(true); // tick as inactive
    }
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
  } else if (message.type === "LOGIN_STATE_CHANGED") {
    handleLoginStateChanged(message.isLoggedIn, message.isOnBreak).then(() => {
      sendResponse({ success: true });
    });
  }
  return true;
});

// Handle login state changes from the popup UI
async function handleLoginStateChanged(isLoggedIn, isOnBreak) {
  const { state } = await getOrInitState();
  
  if (state.isLoggedIn) {
    await tickTracking();
  }
  
  state.isLoggedIn = isLoggedIn;
  state.isOnBreak = isOnBreak;
  state.lastUpdated = Date.now();
  
  await chrome.storage.local.set({ currentState: state });
  await syncToDashboard();
}

// Handle incoming heartbeat from content script
async function handleHeartbeat(isContentActive, projectSuggestion) {
  const { state } = await getOrInitState();
  
  if (state.isLoggedIn) {
    await tickTracking();
  }

  // Update active state based on heartbeat
  state.isActive = isContentActive;
  state.isTracking = true; // Heartbeat implies a tab is open
  state.lastUpdated = Date.now();

  // If content script detected a project from the URL/Page structure, suggest it
  if (projectSuggestion && projectSuggestion !== state.activeProject) {
    if (!state.projects[projectSuggestion]) {
      state.projects[projectSuggestion] = { workTime: 0, idleTime: 0, breakTime: 0, taskCount: 0 };
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
    state.projects[state.activeProject] = { workTime: 0, idleTime: 0, breakTime: 0, taskCount: 0 };
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
    if (state.isLoggedIn) {
      await tickTracking();
    }
    // Sync to dashboard every 10 seconds (irrespective of tracking state, to keep "Offline" status fresh)
    await syncToDashboard();
  }
});

// Run check on startup
chrome.runtime.onInstalled.addListener(() => {
  getOrInitState();
  checkTrackingTabs();
});

chrome.runtime.onStartup.addListener(() => {
  checkTrackingTabs();
});
