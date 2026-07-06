// Content script for Ethara.ai Time & Task Tracker
// Runs on Ethara.ai pages to track work, and on Google Forms to provide auto-fill integrations.

const isGoogleForm = window.location.href.includes("docs.google.com/forms");

if (isGoogleForm) {
  // ==========================================
  // GOOGLE FORM AUTO-FILL INTEGRATION
  // ==========================================
  
  console.log("Ethara.ai Tracker: Google Form detected. Loading integration panel...");
  initGoogleFormIntegration();
} else {
  // ==========================================
  // MULTIMANGO TRACKING ENVIRONMENT
  // ==========================================
  
  initEthara.aiTracking();
}

function initEthara.aiTracking() {
  let lastActivityTime = Date.now();
  let userActiveInInterval = false;
  let idleThresholdMs = 60000; // Default 1 minute
  let heartbeatIntervalId = null;

  const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];

  function updateActivity() {
    lastActivityTime = Date.now();
    userActiveInInterval = true;
  }

  activityEvents.forEach(eventName => {
    window.addEventListener(eventName, updateActivity, { passive: true });
  });

  chrome.storage.local.get(['settings'], (data) => {
    if (data.settings && data.settings.idleThresholdSeconds) {
      idleThresholdMs = data.settings.idleThresholdSeconds * 1000;
    }
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.settings) {
      const newSettings = changes.settings.newValue;
      if (newSettings && newSettings.idleThresholdSeconds) {
        idleThresholdMs = newSettings.idleThresholdSeconds * 1000;
      }
    }
  });

  function getProjectSuggestion() {
    const pathParts = window.location.pathname.split('/').filter(p => p.length > 0);
    if (pathParts.includes('projects') || pathParts.includes('project')) {
      const idx = Math.max(pathParts.indexOf('projects'), pathParts.indexOf('project'));
      if (idx !== -1 && pathParts[idx + 1]) {
        return decodeURIComponent(pathParts[idx + 1])
          .replace(/[-_]/g, ' ')
          .split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
      }
    }

    const selectors = ['.project-title', '.project-name', 'h1.title', 'header h2', '.breadcrumb-item.active'];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim().length > 0) {
        const txt = el.textContent.trim();
        if (txt.length < 30) return txt;
      }
    }

    const docTitle = document.title;
    if (docTitle && docTitle.toLowerCase().includes('multimango')) {
      const cleaned = docTitle.replace(/multimango/i, '').replace(/[-|]/g, '').trim();
      if (cleaned.length > 0 && cleaned.length < 30) return cleaned;
    }
    return null;
  }

  function startHeartbeat() {
    if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);

    heartbeatIntervalId = setInterval(() => {
      const isVisible = document.visibilityState === 'visible';
      const timeSinceLastActivity = Date.now() - lastActivityTime;
      const isCurrentlyIdle = timeSinceLastActivity > idleThresholdMs;
      const isTabActive = isVisible && userActiveInInterval && !isCurrentlyIdle;
      const projectSuggestion = getProjectSuggestion();

      chrome.runtime.sendMessage({
        type: "HEARTBEAT",
        active: isTabActive,
        projectSuggestion: projectSuggestion
      }).catch(() => {});

      userActiveInInterval = false;
    }, 5000);
  }

  const submitLabels = [
    'submit', 'submit task', 'next', 'next task', 
    'finish', 'finish task', 'save', 'save & next', 
    'done', 'confirm', 'approve', 'complete', 'complete task'
  ];

  let lastTaskSubmitTime = 0;
  const SUBMIT_DEBOUNCE_MS = 2000;

  function handlePageClick(event) {
    let target = event.target;
    let clickedButton = null;

    for (let i = 0; i < 4; i++) {
      if (!target) break;
      const tagName = target.tagName ? target.tagName.toLowerCase() : '';
      if (tagName === 'button' || tagName === 'a' || target.getAttribute('role') === 'button') {
        clickedButton = target;
        break;
      }
      target = target.parentElement;
    }

    if (clickedButton) {
      const text = clickedButton.textContent ? clickedButton.textContent.trim().toLowerCase() : '';
      const id = clickedButton.id ? clickedButton.id.toLowerCase() : '';
      const name = clickedButton.name ? clickedButton.name.toLowerCase() : '';
      const classes = clickedButton.className ? clickedButton.className.toLowerCase() : '';

      const matchesLabel = submitLabels.some(label => text === label || text.includes(label));
      const matchesAttrs = id.includes('submit') || name.includes('submit') || classes.includes('submit-btn');

      if (matchesLabel || matchesAttrs) {
        const now = Date.now();
        if (now - lastTaskSubmitTime > SUBMIT_DEBOUNCE_MS) {
          lastTaskSubmitTime = now;
          chrome.runtime.sendMessage({ type: "TASK_COMPLETED" }).catch(() => {});
        }
      }
    }
  }

  document.addEventListener('click', handlePageClick, true);
  startHeartbeat();
  updateActivity();
  console.log("Ethara.ai Tracker: Active and monitoring tasking environment.");
}

// Google Form Autofill logic
async function initGoogleFormIntegration() {
  // Wait for the form to load fully
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Retrieve settings and metrics from storage
  const data = await chrome.storage.local.get(['currentState', 'settings', 'currentDate']);
  const settings = data.settings || {};
  const state = data.currentState || {};
  const today = data.currentDate || new Date().toISOString().split('T')[0];

  if (!settings.employeeName && !state.totalActiveTime) {
    console.log("Ethara.ai Tracker: No local tracking metrics found. Autofill panel disabled.");
    return;
  }

  // Calculate durations in hours
  const activeHours = (state.totalActiveTime || 0) / 3600000;
  const loginHours = (state.totalLoginTime || 0) / 3600000;
  
  // Sum tasks
  let totalTasks = 0;
  if (state.projects) {
    for (const p in state.projects) {
      totalTasks += state.projects[p].taskCount;
    }
  }

  // Render floating panel
  const panel = document.createElement('div');
  panel.id = "ethara-autofill-panel";
  panel.style.position = "fixed";
  panel.style.bottom = "20px";
  panel.style.right = "20px";
  panel.style.zIndex = "999999";
  panel.style.background = "#131b31";
  panel.style.border = "1px solid rgba(255,255,255,0.08)";
  panel.style.borderRadius = "14px";
  panel.style.padding = "16px";
  panel.style.color = "#f3f4f6";
  panel.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.4)";
  panel.style.width = "260px";

  panel.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
      <span style="font-weight: 700; color: #f59e0b; font-size: 13px;">🥭 Ethara.ai Auto-fill</span>
      <button id="ethara-panel-close" style="background: transparent; border: none; color: #9ca3af; cursor: pointer; font-size: 14px;">✕</button>
    </div>
    <div style="font-size: 11px; color: #9ca3af; margin-bottom: 8px; line-height: 1.4;">
      <strong>Name:</strong> ${settings.employeeName || 'N/A'}<br>
      <strong>ID:</strong> ${settings.employeeId || 'N/A'}<br>
      <strong>Work Hours:</strong> ${activeHours.toFixed(2)}h<br>
      <strong>Login Hours:</strong> ${loginHours.toFixed(2)}h<br>
      <strong>Tasks:</strong> ${totalTasks}
    </div>
    <button id="ethara-autofill-btn" style="width: 100%; padding: 8px; background: #6366f1; border: none; border-radius: 8px; color: white; font-weight: 600; font-size: 12px; cursor: pointer; transition: background 0.2s;">
      Auto-fill Today's Log
    </button>
    <div id="ethara-status-msg" style="font-size: 10px; color: #10b981; margin-top: 6px; text-align: center; display: none;">Form successfully auto-filled!</div>
  `;

  document.body.appendChild(panel);

  // Bind close button
  document.getElementById('ethara-panel-close').addEventListener('click', () => {
    panel.style.display = 'none';
  });

  // Bind Autofill Trigger
  document.getElementById('ethara-autofill-btn').addEventListener('click', () => {
    let filledCount = 0;
    
    // Find all question divs in Google Forms
    // Google Forms structures each question in a wrapper, usually containing a label/title
    const questions = document.querySelectorAll('[role="listitem"], .geS54');
    
    questions.forEach(q => {
      // Find question title
      const titleEl = q.querySelector('[role="heading"], .M7ydu, .Qr7Oae');
      if (!titleEl) return;
      
      const titleText = titleEl.textContent.trim().toLowerCase();
      
      // Find input elements inside this question wrapper
      const inputs = q.querySelectorAll('input[type="text"], input[type="date"], input[type="number"], textarea');
      if (inputs.length === 0) return;
      
      inputs.forEach(input => {
        let valueToFill = null;

        // Matching logic
        if (titleText.includes("name") || titleText.includes("employee name") || titleText.includes("fullname")) {
          valueToFill = settings.employeeName;
        } else if (titleText.includes("id") || titleText.includes("employee id") || titleText.includes("empid")) {
          valueToFill = settings.employeeId;
        } else if (titleText.includes("date") || titleText.includes("today")) {
          valueToFill = today;
        } else if (titleText.includes("task") || titleText.includes("completed") || titleText.includes("count") || titleText.includes("quantity")) {
          valueToFill = String(totalTasks);
        } else if (titleText.includes("work") || titleText.includes("active") || titleText.includes("hours worked")) {
          valueToFill = activeHours.toFixed(2);
        } else if (titleText.includes("login") || titleText.includes("session") || titleText.includes("login time")) {
          valueToFill = loginHours.toFixed(2);
        } else if (titleText.includes("hours") || titleText.includes("time") || titleText.includes("duration")) {
          // General hours fallback
          valueToFill = activeHours.toFixed(2);
        }

        if (valueToFill !== null) {
          // Set value
          input.value = valueToFill;
          // Trigger React/Google Form events so it registers the input
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
          filledCount++;
        }
      });
    });

    if (filledCount > 0) {
      const msg = document.getElementById('ethara-status-msg');
      msg.style.display = 'block';
      setTimeout(() => {
        msg.style.display = 'none';
      }, 3000);
    } else {
      alert("No matching fields found (Name, ID, Date, Tasks, or Hours) to auto-fill!");
    }
  });
}
