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

class EtharaTrackerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Ethara.ai Desktop Tracker")
        self.root.geometry("450x700")
        self.root.resizable(False, False)
        
        # Load configuration
        self.config = self.load_config()
        
        # Initialize trackers
        self.total_login_time = 0.0  # seconds
        self.total_active_time = 0.0 # seconds
        self.total_idle_time = 0.0   # seconds
        self.total_break_time = 0.0  # seconds
        self.last_input_time = time.time()
        self.projects = {
            self.config["activeProject"]: {
                "workTime": 0.0,
                "idleTime": 0.0,
                "breakTime": 0.0,
                "taskCount": 0
            }
        }
        
        # Flags
        self.is_logged_in = False
        self.is_on_break = False
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
        # Black Theme
        self.bg_dark = "#000000"
        self.bg_card = "#0c0c0c"
        self.fg_main = "#f3f4f6"
        self.fg_muted = "#9ca3af"
        
        self.color_work = "#00f2fe"
        self.color_login = "#ff0844"
        self.color_idle = "#f59e0b"
        self.color_break = "#6366f1"
        self.color_accent = "#10b981"
        
        self.root.configure(bg=self.bg_dark)
        
        self.style = ttk.Style()
        self.style.theme_use('clam')
        self.style.configure('.', background=self.bg_dark, foreground=self.fg_main)

    def create_widgets(self):
        # Header
        header_frame = tk.Frame(self.root, bg=self.bg_dark, pady=15)
        header_frame.pack(fill="x", padx=20)
        
        title_lbl = tk.Label(header_frame, text="Ethara.ai Tracker", font=("Outfit", 18, "bold"), fg=self.color_work, bg=self.bg_dark)
        title_lbl.pack(side="left")
        
        self.status_lbl = tk.Label(header_frame, text="Offline", font=("Outfit", 10, "bold"), fg=self.fg_muted, bg="#181818", px=8, py=2)
        self.status_lbl.pack(side="right")

        # Config Panel (Accordion / Collapsible-like Frame)
        config_frame = tk.LabelFrame(self.root, text=" Employee Profile & Settings ", bg=self.bg_dark, fg=self.color_break, font=("Outfit", 10, "bold"), bd=1, relief="solid")
        config_frame.pack(fill="x", padx=20, pady=5)
        
        tk.Label(config_frame, text="Employee ID:", bg=self.bg_dark, fg=self.fg_muted).grid(row=0, column=0, sticky="w", padx=10, pady=4)
        self.id_ent = tk.Entry(config_frame, bg=self.bg_card, fg=self.fg_main, insertbackground="white", bd=0, highlightthickness=1, highlightbackground="#222222")
        self.id_ent.grid(row=0, column=1, sticky="ew", padx=10, pady=4)
        self.id_ent.insert(0, self.config["employeeId"])
        
        tk.Label(config_frame, text="Employee Name:", bg=self.bg_dark, fg=self.fg_muted).grid(row=1, column=0, sticky="w", padx=10, pady=4)
        self.name_ent = tk.Entry(config_frame, bg=self.bg_card, fg=self.fg_main, insertbackground="white", bd=0, highlightthickness=1, highlightbackground="#222222", state="readonly")
        self.name_ent.grid(row=1, column=1, sticky="ew", padx=10, pady=4)
        # We will populate it upon ID verification
        self.update_name_field(self.config["employeeName"])

        tk.Label(config_frame, text="Sync Server URL:", bg=self.bg_dark, fg=self.fg_muted).grid(row=2, column=0, sticky="w", padx=10, pady=4)
        self.url_ent = tk.Entry(config_frame, bg=self.bg_card, fg=self.fg_main, insertbackground="white", bd=0, highlightthickness=1, highlightbackground="#222222")
        self.url_ent.grid(row=2, column=1, sticky="ew", padx=10, pady=4)
        self.url_ent.insert(0, self.config["syncUrl"])

        save_btn = tk.Button(config_frame, text="Verify & Save Profile", command=self.save_settings, bg=self.color_break, fg="white", font=("Outfit", 9, "bold"), bd=0, cursor="hand2", activebackground="#4f46e5")
        save_btn.grid(row=3, column=0, columnspan=2, sticky="ew", padx=10, pady=8)

        config_frame.columnconfigure(1, weight=1)

        # Control Panel (Login/Logout & Break Buttons)
        control_frame = tk.Frame(self.root, bg=self.bg_dark, pady=10)
        control_frame.pack(fill="x", padx=20)

        self.login_btn = tk.Button(control_frame, text="Login", command=self.toggle_login, bg="#1d4ed8", fg="white", font=("Outfit", 11, "bold"), bd=0, cursor="hand2", activebackground="#1e40af")
        self.login_btn.pack(side="left", fill="x", expand=True, padx=(0, 5))

        self.break_btn = tk.Button(control_frame, text="Break", command=self.toggle_break, bg="#374151", fg="white", font=("Outfit", 11, "bold"), bd=0, cursor="hand2", activebackground="#4b5563", state="disabled")
        self.break_btn.pack(side="right", fill="x", expand=True, padx=(5, 0))

        # Metrics Panel
        metrics_frame = tk.Frame(self.root, bg=self.bg_dark)
        metrics_frame.pack(fill="x", padx=20, pady=5)

        # 4 Metrics: Work, Login, Idle, Break
        self.work_time_val = self.create_metric_card(metrics_frame, "Active Work Time", "00:00:00", self.color_work, 0, 0)
        self.login_time_val = self.create_metric_card(metrics_frame, "Login/Session Time", "00:00:00", self.color_login, 0, 1)
        self.idle_time_val = self.create_metric_card(metrics_frame, "Total Idle Duration", "00:00:00", self.color_idle, 1, 0)
        self.break_time_val = self.create_metric_card(metrics_frame, "Total Break Time", "00:00:00", self.color_break, 1, 1)

        metrics_frame.columnconfigure(0, weight=1)
        metrics_frame.columnconfigure(1, weight=1)

        # Project Selector & Task Logger Frame
        action_frame = tk.Frame(self.root, bg=self.bg_card, bd=1, relief="solid", highlightthickness=0)
        action_frame.pack(fill="x", padx=20, pady=10)

        # Active Project label & selector
        tk.Label(action_frame, text="Active Project:", bg=self.bg_card, fg=self.fg_muted, font=("Outfit", 9)).grid(row=0, column=0, sticky="w", padx=15, pady=(15, 5))
        self.project_ent = tk.Entry(action_frame, bg=self.bg_dark, fg=self.fg_main, insertbackground="white", bd=0, highlightthickness=1, highlightbackground="#222222", font=("Outfit", 10))
        self.project_ent.grid(row=0, column=1, sticky="ew", padx=10, pady=(15, 5))
        self.project_ent.insert(0, self.config["activeProject"])

        switch_btn = tk.Button(action_frame, text="Switch", command=self.switch_project, bg="#1f2937", fg="white", font=("Outfit", 9, "bold"), bd=0, cursor="hand2", activebackground="#111827")
        switch_btn.grid(row=0, column=2, sticky="ew", padx=15, pady=(15, 5))

        # Task counter display
        tk.Label(action_frame, text="Tasks Completed:", bg=self.bg_card, fg=self.fg_muted, font=("Outfit", 9)).grid(row=1, column=0, sticky="w", padx=15, pady=(5, 15))
        self.task_lbl = tk.Label(action_frame, text="0", font=("Outfit", 16, "bold"), fg=self.color_accent, bg=self.bg_card)
        self.task_lbl.grid(row=1, column=1, sticky="w", padx=10, pady=(5, 15))

        self.log_task_btn = tk.Button(action_frame, text="+1 Task", command=self.log_task, bg="#10b981", fg="white", font=("Outfit", 10, "bold"), bd=0, cursor="hand2", activebackground="#059669")
        self.log_task_btn.grid(row=1, column=2, sticky="ew", padx=15, pady=(5, 15))

        action_frame.columnconfigure(1, weight=1)

        # Footer
        footer_lbl = tk.Label(self.root, text="System-wide tracking active • Targets: Work 6h, Login 8h", font=("Outfit", 9), fg=self.fg_muted, bg=self.bg_dark)
        footer_lbl.pack(side="bottom", pady=15)

    def create_metric_card(self, parent, label, value, color, row, col):
        card = tk.Frame(parent, bg=self.bg_card, bd=1, relief="solid", padx=15, pady=12)
        card.grid(row=row, column=col, sticky="nsew", padx=5, pady=5)
        
        lbl = tk.Label(card, text=label, font=("Outfit", 8, "bold"), fg=self.fg_muted, bg=self.bg_card)
        lbl.pack(anchor="w")
        
        val_lbl = tk.Label(card, text=value, font=("Plus Jakarta Sans", 15, "bold"), fg=color, bg=self.bg_card)
        val_lbl.pack(anchor="w", pady=(4, 0))
        
        return val_lbl

    def update_name_field(self, name):
        self.name_ent.config(state="normal")
        self.name_ent.delete(0, tk.END)
        self.name_ent.insert(0, name)
        self.name_ent.config(state="readonly")

    def save_settings(self):
        emp_id = self.id_ent.get().strip()
        sync_url = self.url_ent.get().strip().rstrip("/")
        
        if not emp_id or not sync_url:
            messagebox.showerror("Error", "Please fill in both Employee ID and Sync Server URL!")
            return

        # Verify Employee ID against the central registry database
        try:
            res = requests.get(f"{sync_url}/api/employees/verify?id={emp_id}", timeout=4)
            if res.status_code == 200:
                data = res.json()
                if data.get("exists"):
                    emp_name = data.get("name", "Employee")
                    self.update_name_field(emp_name)
                    
                    self.config["employeeName"] = emp_name
                    self.config["employeeId"] = emp_id
                    self.config["syncUrl"] = sync_url
                    
                    self.save_config()
                    messagebox.showinfo("Verified & Saved", f"Profile verified successfully!\nEmployee Name: {emp_name}")
                else:
                    messagebox.showerror("Invalid ID", "Employee ID is not registered in the Admin Web registry database.")
            else:
                messagebox.showerror("Connection Error", "Server returned an invalid status code during verification.")
        except Exception as e:
            messagebox.showerror("Verification Failed", f"Could not connect to the verification server:\n{str(e)}")

    def toggle_login(self):
        if not self.config["employeeId"] or not self.config["syncUrl"]:
            messagebox.showerror("Error", "Please verify and save your Employee ID settings first!")
            return

        if not self.is_logged_in:
            # Handle Login
            self.is_logged_in = True
            self.is_on_break = False
            self.login_btn.config(text="Logout", bg="#4b5563", activebackground="#374151")
            self.break_btn.config(state="normal", text="Break", bg="#374151", activebackground="#4b5563")
            messagebox.showinfo("Logged In", "Your shift tracking session has started!")
        else:
            # Handle Logout
            self.is_logged_in = False
            self.is_on_break = False
            self.login_btn.config(text="Login", bg="#1d4ed8", activebackground="#1e40af")
            self.break_btn.config(state="disabled", text="Break", bg="#374151")
            messagebox.showinfo("Logged Out", "Your shift session has been ended.")
            
        self.sync_dashboard()

    def toggle_break(self):
        if not self.is_logged_in:
            return

        if not self.is_on_break:
            # Enter break mode
            self.is_on_break = True
            self.break_btn.config(text="Resume", bg=self.color_accent, activebackground="#059669")
        else:
            # Exit break mode
            self.is_on_break = False
            self.break_btn.config(text="Break", bg="#374151", activebackground="#4b5563")
            
        self.sync_dashboard()

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
                    "breakTime": 0.0,
                    "taskCount": 0
                }
            
            messagebox.showinfo("Project Switched", f"Active project changed from '{old_project}' to '{new_project}'.")

    def log_task(self):
        active_proj = self.config["activeProject"]
        if active_proj not in self.projects:
            self.projects[active_proj] = {"workTime": 0.0, "idleTime": 0.0, "breakTime": 0.0, "taskCount": 0}
        self.projects[active_proj]["taskCount"] += 1
        
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
            
            if not self.is_logged_in:
                # Safe GUI updates from thread
                self.root.after(0, self.update_gui_timers)
                continue

            # Increment session/login time
            self.total_login_time += 1.0

            # Check active window
            title = get_active_window_title().lower()
            self.is_tracking = "multimango" in title
            
            # Check user inactivity threshold
            idle_limit = self.config["idleThresholdSeconds"]
            self.is_user_active = (time.time() - self.last_input_time) < idle_limit

            active_proj = self.config["activeProject"]
            if active_proj not in self.projects:
                self.projects[active_proj] = {"workTime": 0.0, "idleTime": 0.0, "breakTime": 0.0, "taskCount": 0}

            proj = self.projects[active_proj]
            if "breakTime" not in proj:
                proj["breakTime"] = 0.0

            # Accumulate metrics
            if self.is_on_break:
                # Accumulate Break Time
                self.total_break_time += 1.0
                proj["breakTime"] += 1.0
            else:
                if self.is_tracking:
                    if self.is_user_active:
                        self.total_active_time += 1.0
                        proj["workTime"] += 1.0
                    else:
                        self.total_idle_time += 1.0
                        proj["idleTime"] += 1.0
                else:
                    # Logged in but not on active window -> counts as idle
                    self.total_idle_time += 1.0
                    proj["idleTime"] += 1.0

            # Safe GUI updates from thread
            self.root.after(0, self.update_gui_timers)

    def update_gui_timers(self):
        # Update timer strings
        self.work_time_val.config(text=self.format_duration(self.total_active_time))
        self.login_time_val.config(text=self.format_duration(self.total_login_time))
        self.idle_time_val.config(text=self.format_duration(self.total_idle_time))
        self.break_time_val.config(text=self.format_duration(self.total_break_time))
        
        # Update Status Badge
        if self.is_logged_in:
            if self.is_on_break:
                self.status_lbl.config(text="Break", fg=self.color_break)
            elif self.is_tracking:
                if self.is_user_active:
                    self.status_lbl.config(text="Working", fg=self.color_work)
                else:
                    self.status_lbl.config(text="Idle", fg=self.color_idle)
            else:
                self.status_lbl.config(text="Idle", fg=self.color_idle)
        else:
            self.status_lbl.config(text="Offline", fg=self.fg_muted)

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
                "breakTime": int(data.get("breakTime", 0.0) * 1000),
                "taskCount": data["taskCount"]
            }

        is_online = self.is_logged_in and not force_offline
        status = "Offline"
        if not force_offline and self.is_logged_in:
            if self.is_on_break:
                status = "Break"
            elif self.is_tracking:
                status = "Working" if self.is_user_active else "Idle"
            else:
                status = "Idle"

        payload = {
            "employeeId": emp_id,
            "employeeName": emp_name,
            "date": time.strftime("%Y-%m-%d"),
            "activeProject": active_proj,
            "loginTime": int(self.total_login_time * 1000),
            "activeTime": int(self.total_active_time * 1000),
            "idleTime": int(self.total_idle_time * 1000),
            "breakTime": int(self.total_break_time * 1000),
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
    app = EtharaTrackerApp(root)
    root.mainloop()
