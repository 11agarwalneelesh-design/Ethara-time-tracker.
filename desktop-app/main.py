import tkinter as tk
from tkinter import ttk, messagebox
import ctypes
import time
import json
import os
import threading
import requests
from pynput import mouse, keyboard

CONFIG_FILE = "config.json"

# Default configuration structure
DEFAULT_CONFIG = {
    "employeeName": "",
    "employeeId": "",
    "syncUrl": "http://localhost:3000",
    "targetWorkHours": 6.0,
    "targetLoginHours": 8.0,
    "idleThresholdSeconds": 60,
    "activeProject": "General"
}

# Windows Foreground Window title tracker
def get_active_window_title():
    try:
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buff = ctypes.create_unicode_buffer(length + 1)
            ctypes.windll.user32.GetWindowTextW(hwnd, buff, length + 1)
            return buff.value
        return ""
    except Exception:
        return ""

class Ethara.aiTrackerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Ethara.ai Desktop Tracker")
        self.root.geometry("450x640")
        self.root.resizable(False, False)
        
        # Load configuration
        self.config = self.load_config()
        
        # Initialize trackers
        self.total_login_time = 0.0  # seconds
        self.total_active_time = 0.0 # seconds
        self.total_idle_time = 0.0   # seconds
        self.last_input_time = time.time()
        self.projects = {
            self.config["activeProject"]: {
                "workTime": 0.0,
                "idleTime": 0.0,
                "taskCount": 0
            }
        }
        
        # Flags
        self.is_tracking = False
        self.is_user_active = False
        self.is_running = True
        
        # UI Styling
        self.setup_styles()
        self.create_widgets()
        
        # Start input listeners
        self.start_input_listeners()
        
        # Start background tracking threads
        self.tracking_thread = threading.Thread(target=self.track_loop, daemon=True)
        self.tracking_thread.start()
        
        self.sync_thread = threading.Thread(target=self.sync_loop, daemon=True)
        self.sync_thread.start()
        
        # Window closing handler to send offline sync
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)

    def load_config(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    config = json.load(f)
                    # Merge defaults in case of missing keys
                    for k, v in DEFAULT_CONFIG.items():
                        if k not in config:
                            config[k] = v
                    return config
            except Exception:
                pass
        return DEFAULT_CONFIG.copy()

    def save_config(self):
        try:
            with open(CONFIG_FILE, "w") as f:
                json.dump(self.config, f, indent=2)
        except Exception as e:
            print("Failed to save config:", e)

    def setup_styles(self):
        # Slate theme styling
        self.bg_dark = "#000000"
        self.bg_card = "#0c0c0c"
        self.fg_main = "#f3f4f6"
        self.fg_muted = "#9ca3af"
        
        self.color_work = "#00f2fe"
        self.color_login = "#ff0844"
        self.color_idle = "#f59e0b"
        self.color_accent = "#6366f1"
        
        self.root.configure(bg=self.bg_dark)
        
        self.style = ttk.Style()
        self.style.theme_use('clam')
        self.style.configure('.', background=self.bg_dark, foreground=self.fg_main)

    def create_widgets(self):
        # Header
        header_frame = tk.Frame(self.root, bg=self.bg_dark, pady=15)
        header_frame.pack(fill="x", px=20)
        
        
        
        title_lbl = tk.Label(header_frame, text="Ethara.ai Tracker", font=("Outfit", 16, "bold"), fg=self.color_idle, bg=self.bg_dark)
        title_lbl.pack(side="left")
        
        self.status_lbl = tk.Label(header_frame, text="Offline", font=("Outfit", 10, "bold"), fg=self.fg_muted, bg="#181818", px=8, py=2)
        self.status_lbl.pack(side="right")

        # Config Panel (Accordion / Collapsible-like Frame)
        config_frame = tk.LabelFrame(self.root, text=" Employee Profile & Settings ", bg=self.bg_dark, fg=self.color_accent, font=("Outfit", 10, "bold"), bd=1, relief="solid")
        config_frame.pack(fill="x", padx=20, pady=10)
        
        tk.Label(config_frame, text="Employee Name:", bg=self.bg_dark, fg=self.fg_muted).grid(row=0, column=0, sticky="w", padx=10, pady=4)
        self.name_ent = tk.Entry(config_frame, bg=self.bg_card, fg=self.fg_main, insertbackground="white", bd=0, highlightthickness=1, highlightbackground="#222222")
        self.name_ent.insert(0, self.config["employeeName"])
        self.name_ent.grid(row=0, column=1, sticky="ew", padx=10, pady=4)

        tk.Label(config_frame, text="Employee ID:", bg=self.bg_dark, fg=self.fg_muted).grid(row=1, column=0, sticky="w", padx=10, pady=4)
        self.id_ent = tk.Entry(config_frame, bg=self.bg_card, fg=self.fg_main, insertbackground="white", bd=0, highlightthickness=1, highlightbackground="#222222")
        self.id_ent.insert(0, self.config["employeeId"])
        self.id_ent.grid(row=1, column=1, sticky="ew", padx=10, pady=4)

        tk.Label(config_frame, text="Sync Server URL:", bg=self.bg_dark, fg=self.fg_muted).grid(row=2, column=0, sticky="w", padx=10, pady=4)
        self.url_ent = tk.Entry(config_frame, bg=self.bg_card, fg=self.fg_main, insertbackground="white", bd=0, highlightthickness=1, highlightbackground="#222222")
        self.url_ent.insert(0, self.config["syncUrl"])
        self.url_ent.grid(row=2, column=1, sticky="ew", padx=10, pady=4)

        save_btn = tk.Button(config_frame, text="Save Settings", command=self.save_settings, bg=self.color_accent, fg="white", font=("Outfit", 9, "bold"), bd=0, activebackground="#4f46e5", activeforeground="white", cursor="hand2")
        save_btn.grid(row=3, column=0, columnspan=2, sticky="ew", padx=10, pady=8)
        
        config_frame.columnconfigure(1, weight=1)

        # Timers Card
        timers_frame = tk.Frame(self.root, bg=self.bg_card, bd=1, relief="solid")
        timers_frame.pack(fill="x", padx=20, pady=10)
        
        # Row 1: Work Time
        work_lbl = tk.Label(timers_frame, text="ACTIVE WORK TIME", font=("Outfit", 9, "bold"), fg=self.fg_muted, bg=self.bg_card)
        work_lbl.grid(row=0, column=0, sticky="w", padx=15, pady=(12, 2))
        self.work_time_val = tk.Label(timers_frame, text="00:00:00", font=("Outfit", 20, "bold"), fg=self.color_work, bg=self.bg_card)
        self.work_time_val.grid(row=1, column=0, sticky="w", padx=15, pady=(0, 10))

        # Row 1 Column 2: Login Time
        login_lbl = tk.Label(timers_frame, text="LOGIN SESSION TIME", font=("Outfit", 9, "bold"), fg=self.fg_muted, bg=self.bg_card)
        login_lbl.grid(row=0, column=1, sticky="w", padx=15, pady=(12, 2))
        self.login_time_val = tk.Label(timers_frame, text="00:00:00", font=("Outfit", 20, "bold"), fg=self.color_login, bg=self.bg_card)
        self.login_time_val.grid(row=1, column=1, sticky="w", padx=15, pady=(0, 10))

        # Row 2: Idle Time
        idle_lbl = tk.Label(timers_frame, text="TOTAL IDLE TIME", font=("Outfit", 9, "bold"), fg=self.fg_muted, bg=self.bg_card)
        idle_lbl.grid(row=2, column=0, sticky="w", padx=15, pady=(5, 2))
        self.idle_time_val = tk.Label(timers_frame, text="00:00:00", font=("Outfit", 14, "bold"), fg=self.color_idle, bg=self.bg_card)
        self.idle_time_val.grid(row=3, column=0, sticky="w", padx=15, pady=(0, 12))

        timers_frame.columnconfigure(0, weight=1)
        timers_frame.columnconfigure(1, weight=1)

        # Projects & Tasks Area
        action_frame = tk.Frame(self.root, bg=self.bg_card, bd=1, relief="solid")
        action_frame.pack(fill="x", padx=20, pady=10)
        
        tk.Label(action_frame, text="Active Project:", font=("Outfit", 10, "bold"), fg=self.fg_muted, bg=self.bg_card).grid(row=0, column=0, sticky="w", padx=15, pady=(12, 4))
        self.project_ent = tk.Entry(action_frame, bg=self.bg_dark, fg=self.fg_main, insertbackground="white", bd=0, highlightthickness=1, highlightbackground="#222222")
        self.project_ent.insert(0, self.config["activeProject"])
        self.project_ent.grid(row=0, column=1, sticky="ew", padx=15, pady=(12, 4))

        switch_btn = tk.Button(action_frame, text="Switch Project", command=self.switch_project, bg="#181818", fg=self.fg_main, font=("Outfit", 8, "bold"), bd=0, cursor="hand2")
        switch_btn.grid(row=0, column=2, sticky="e", padx=15, pady=(12, 4))

        # Tasks Count Section
        tk.Label(action_frame, text="Tasks Completed Today:", font=("Outfit", 10, "bold"), fg=self.fg_muted, bg=self.bg_card).grid(row=1, column=0, sticky="w", padx=15, pady=(10, 15))
        self.task_lbl = tk.Label(action_frame, text="0", font=("Outfit", 16, "bold"), fg="white", bg=self.bg_card)
        self.task_lbl.grid(row=1, column=1, sticky="w", padx=15, pady=(10, 15))

        self.log_task_btn = tk.Button(action_frame, text="+1 Task", command=self.log_task, bg="#10b981", fg="white", font=("Outfit", 10, "bold"), bd=0, cursor="hand2", activebackground="#059669")
        self.log_task_btn.grid(row=1, column=2, sticky="ew", padx=15, pady=(10, 15))

        action_frame.columnconfigure(1, weight=1)

        # Footer
        footer_lbl = tk.Label(self.root, text="System-wide tracking active • Targets: Work 6h, Login 8h", font=("Outfit", 9), fg=self.fg_muted, bg=self.bg_dark)
        footer_lbl.pack(side="bottom", pady=15)

    def save_settings(self):
        self.config["employeeName"] = self.name_ent.get().strip()
        self.config["employeeId"] = self.id_ent.get().strip()
        self.config["syncUrl"] = self.url_ent.get().strip()
        
        self.save_config()
        messagebox.showinfo("Settings Saved", "Employee profile settings have been updated and saved successfully!")

    def switch_project(self):
        new_project = self.project_ent.get().strip()
        if not new_project:
            return
            
        old_project = self.config["activeProject"]
        if new_project != old_project:
            self.config["activeProject"] = new_project
            self.save_config()
            
            # Initialize project metrics if new
            if new_project not in self.projects:
                self.projects[new_project] = {
                    "workTime": 0.0,
                    "idleTime": 0.0,
                    "taskCount": 0
                }
            
            # Inform user
            messagebox.showinfo("Project Switched", f"Active project changed from '{old_project}' to '{new_project}'.")

    def log_task(self):
        active_proj = self.config["activeProject"]
        if active_proj not in self.projects:
            self.projects[active_proj] = {"workTime": 0.0, "idleTime": 0.0, "taskCount": 0}
        self.projects[active_proj]["taskCount"] += 1
        
        # Update UI counter
        self.update_task_counter()
        
        # Trigger immediate sync
        threading.Thread(target=self.sync_dashboard, daemon=True).start()

    def update_task_counter(self):
        total = sum(p["taskCount"] for p in self.projects.values())
        self.task_lbl.config(text=str(total))

    # Listeners for mouse/keyboard inputs
    def start_input_listeners(self):
        def on_activity(*args, **kwargs):
            self.last_input_time = time.time()

        # Start non-blocking mouse and keyboard listeners
        self.mouse_listener = mouse.Listener(on_move=on_activity, on_click=on_activity, on_scroll=on_activity)
        self.keyboard_listener = keyboard.Listener(on_press=on_activity)
        
        self.mouse_listener.start()
        self.keyboard_listener.start()

    def format_duration(self, seconds):
        s = int(seconds)
        hrs = s // 3600
        mins = (s % 3600) // 60
        secs = s % 60
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"

    # Main tracking loop (ticks once per second)
    def track_loop(self):
        while self.is_running:
            time.sleep(1.0)
            
            # Check active window
            title = get_active_window_title().lower()
            
            # Is user on Ethara.ai?
            self.is_tracking = "multimango" in title
            
            # Check user inactivity threshold
            idle_limit = self.config["idleThresholdSeconds"]
            self.is_user_active = (time.time() - self.last_input_time) < idle_limit

            active_proj = self.config["activeProject"]
            if active_proj not in self.projects:
                self.projects[active_proj] = {"workTime": 0.0, "idleTime": 0.0, "taskCount": 0}

            proj = self.projects[active_proj]

            # Accumulate metrics
            if self.is_tracking:
                self.total_login_time += 1.0
                
                if self.is_user_active:
                    self.total_active_time += 1.0
                    proj["workTime"] += 1.0
                else:
                    self.total_idle_time += 1.0
                    proj["idleTime"] += 1.0

            # Safe GUI updates from thread
            self.root.after(0, self.update_gui_timers)

    def update_gui_timers(self):
        # Update timer strings
        self.work_time_val.config(text=self.format_duration(self.total_active_time))
        self.login_time_val.config(text=self.format_duration(self.total_login_time))
        self.idle_time_val.config(text=self.format_duration(self.total_idle_time))
        
        # Update Status Badge
        if self.is_tracking:
            if self.is_user_active:
                self.status_lbl.config(text="Working", fg=self.color_work)
            else:
                self.status_lbl.config(text="Idle", fg=self.color_idle)
        else:
            self.status_lbl.config(text="Inactive", fg=self.fg_muted)

    # Sync server sync loop (ticks once every 10 seconds)
    def sync_loop(self):
        while self.is_running:
            time.sleep(10.0)
            self.sync_dashboard()

    def sync_dashboard(self, force_offline=False):
        sync_url = self.config["syncUrl"].strip()
        if not sync_url:
            return

        sync_url = sync_url.rstrip("/")

        # Prepare payload
        emp_name = self.config["employeeName"] or "Employee"
        emp_id = self.config["employeeId"] or "N/A"
        active_proj = self.config["activeProject"]
        
        # Format projects dictionary timings from seconds to milliseconds
        projects_payload = {}
        for name, data in self.projects.items():
            projects_payload[name] = {
                "workTime": int(data["workTime"] * 1000),
                "idleTime": int(data["idleTime"] * 1000),
                "taskCount": data["taskCount"]
            }

        is_online = self.is_tracking and not force_offline
        status = "Offline"
        if not force_offline:
            if self.is_tracking:
                status = "Working" if self.is_user_active else "Idle"
            else:
                status = "Offline"

        payload = {
            "employeeId": emp_id,
            "employeeName": emp_name,
            "date": time.strftime("%Y-%m-%d"),
            "activeProject": active_proj,
            "loginTime": int(self.total_login_time * 1000),
            "activeTime": int(self.total_active_time * 1000),
            "idleTime": int(self.total_idle_time * 1000),
            "projects": projects_payload,
            "isOnline": is_online,
            "status": status
        }

        try:
            requests.post(f"{sync_url}/api/sync", json=payload, timeout=3)
        except Exception:
            # Silently ignore sync connection issues in client
            pass

    def on_closing(self):
        self.is_running = False
        
        # Stop mouse/keyboard listeners
        try:
            self.mouse_listener.stop()
            self.keyboard_listener.stop()
        except Exception:
            pass
            
        # Send final offline status to server in a separate thread
        sync_thread = threading.Thread(target=self.sync_dashboard, args=(True,))
        sync_thread.start()
        
        # Wait max 1.5s for sync to complete before terminating app
        sync_thread.join(timeout=1.5)
        
        self.root.destroy()

if __name__ == "__main__":
    root = tk.Tk()
    app = Ethara.aiTrackerApp(root)
    root.mainloop()
