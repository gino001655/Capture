mod config;
mod journal;
mod special;
mod processor;
mod worker;
mod window_position;

use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::{
    config::{ConnectionSettingsSummary, WorkerConfig},
    worker::CreatedCapture,
};

const CHECK_INTERVAL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerSnapshot {
    kind: String,
    message: String,
    job_id: Option<String>,
    last_checked_at: Option<u64>,
    paused: bool,
    checking: bool,
}

impl Default for WorkerSnapshot {
    fn default() -> Self {
        Self {
            kind: "ready".to_owned(),
            message: "Waiting for the first background check.".to_owned(),
            job_id: None,
            last_checked_at: None,
            paused: false,
            checking: false,
        }
    }
}

struct WorkerRuntime {
    snapshot: Mutex<WorkerSnapshot>,
    checking: AtomicBool,
    paused: AtomicBool,
}

impl WorkerRuntime {
    fn new() -> Self {
        Self {
            snapshot: Mutex::new(WorkerSnapshot::default()),
            checking: AtomicBool::new(false),
            paused: AtomicBool::new(false),
        }
    }

    fn snapshot(&self) -> WorkerSnapshot {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_else(|_| WorkerSnapshot {
                kind: "error".to_owned(),
                message: "Worker state could not be read.".to_owned(),
                ..WorkerSnapshot::default()
            })
    }

    fn replace_snapshot(&self, snapshot: WorkerSnapshot) {
        if let Ok(mut current) = self.snapshot.lock() {
            *current = snapshot;
        }
    }
}

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn emit_snapshot(app: &AppHandle, snapshot: &WorkerSnapshot) {
    let _ = app.emit("worker-status", snapshot);
}

async fn run_worker_check(app: AppHandle, runtime: Arc<WorkerRuntime>) -> WorkerSnapshot {
    if runtime.paused.load(Ordering::SeqCst) {
        let mut snapshot = runtime.snapshot();
        snapshot.kind = "paused".to_owned();
        snapshot.message = "Worker is paused.".to_owned();
        snapshot.paused = true;
        snapshot.checking = false;
        runtime.replace_snapshot(snapshot.clone());
        emit_snapshot(&app, &snapshot);
        return snapshot;
    }

    if runtime.checking.swap(true, Ordering::SeqCst) {
        return runtime.snapshot();
    }

    let mut checking_snapshot = runtime.snapshot();
    checking_snapshot.kind = "checking".to_owned();
    checking_snapshot.message = "Checking the API for pending work...".to_owned();
    checking_snapshot.checking = true;
    checking_snapshot.paused = false;
    runtime.replace_snapshot(checking_snapshot.clone());
    emit_snapshot(&app, &checking_snapshot);

    let result = match WorkerConfig::load(&app) {
        Ok(config) => worker::check_for_work(&config).await,
        Err(error) => Err(error),
    };

    let snapshot = match result {
        Ok(report) => WorkerSnapshot {
            kind: report.outcome.to_owned(),
            message: report.message,
            job_id: report.job_id,
            last_checked_at: Some(unix_time_millis()),
            paused: false,
            checking: false,
        },
        Err(message) => WorkerSnapshot {
            kind: "error".to_owned(),
            message,
            job_id: None,
            last_checked_at: Some(unix_time_millis()),
            paused: false,
            checking: false,
        },
    };

    runtime.checking.store(false, Ordering::SeqCst);
    runtime.replace_snapshot(snapshot.clone());
    emit_snapshot(&app, &snapshot);
    snapshot
}

fn set_worker_paused(
    app: &AppHandle,
    runtime: &Arc<WorkerRuntime>,
    paused: bool,
) -> WorkerSnapshot {
    runtime.paused.store(paused, Ordering::SeqCst);
    let mut snapshot = runtime.snapshot();
    snapshot.paused = paused;
    snapshot.kind = if paused { "paused" } else { "ready" }.to_owned();
    snapshot.message = if paused {
        "Worker is paused.".to_owned()
    } else {
        "Worker resumed. Waiting for the next check.".to_owned()
    };
    runtime.replace_snapshot(snapshot.clone());
    emit_snapshot(app, &snapshot);
    snapshot
}

fn show_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn show_capture_window(app: &AppHandle) {
    window_position::restore(app);
    let _ = app.emit_to("capture", "open-quick-capture", ());
    show_window(app, "capture");
}

fn toggle_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_window(app, label);
        }
    }
}

fn start_background_worker(app: AppHandle, runtime: Arc<WorkerRuntime>) {
    thread::spawn(move || loop {
        tauri::async_runtime::block_on(run_worker_check(app.clone(), runtime.clone()));
        thread::sleep(CHECK_INTERVAL);
    });
}

fn setup_tray(app: &tauri::App, runtime: Arc<WorkerRuntime>) -> tauri::Result<()> {
    let capture_item = MenuItem::with_id(app, "capture", "Quick Capture", true, None::<&str>)?;
    let worker_item = MenuItem::with_id(app, "worker", "Worker Status", true, None::<&str>)?;
    let check_item = MenuItem::with_id(app, "check", "Check Now", true, None::<&str>)?;
    let pause_item = CheckMenuItem::with_id(
        app,
        "paused",
        "Pause Worker",
        true,
        runtime.paused.load(Ordering::SeqCst),
        None::<&str>,
    )?;
    let start_with_windows_item = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &capture_item,
            &worker_item,
            &check_item,
            &pause_item,
            &start_with_windows_item,
            &separator,
            &quit_item,
        ],
    )?;

    let pause_for_menu = pause_item.clone();
    let autostart_for_menu = start_with_windows_item.clone();
    let runtime_for_menu = runtime.clone();

    TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .expect("the bundle must include a default icon")
                .clone(),
        )
        .tooltip("Personal Capture")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "capture" => show_capture_window(app),
            "worker" => show_window(app, "main"),
            "check" => {
                let app = app.clone();
                let runtime = runtime_for_menu.clone();
                tauri::async_runtime::spawn(async move {
                    run_worker_check(app, runtime).await;
                });
            }
            "paused" => {
                let paused = pause_for_menu.is_checked().unwrap_or(false);
                set_worker_paused(app, &runtime_for_menu, paused);
            }
            "autostart" => {
                let enabled = autostart_for_menu.is_checked().unwrap_or(false);
                let result = if enabled {
                    app.autolaunch().enable()
                } else {
                    app.autolaunch().disable()
                };

                if result.is_err() {
                    let _ = autostart_for_menu.set_checked(!enabled);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_capture_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
async fn check_for_work(
    app: AppHandle,
    runtime: tauri::State<'_, Arc<WorkerRuntime>>,
) -> Result<WorkerSnapshot, String> {
    Ok(run_worker_check(app, runtime.inner().clone()).await)
}

#[tauri::command]
fn get_worker_status(runtime: tauri::State<'_, Arc<WorkerRuntime>>) -> WorkerSnapshot {
    runtime.snapshot()
}

#[tauri::command]
fn set_pause(
    app: AppHandle,
    runtime: tauri::State<'_, Arc<WorkerRuntime>>,
    paused: bool,
) -> WorkerSnapshot {
    set_worker_paused(&app, runtime.inner(), paused)
}

#[tauri::command]
async fn create_capture(app: AppHandle, content: String) -> Result<CreatedCapture, String> {
    let config = WorkerConfig::load(&app)?;
    worker::create_capture(&config, content.trim()).await
}

#[tauri::command]
fn get_connection_settings(app: AppHandle) -> ConnectionSettingsSummary {
    WorkerConfig::summary(&app)
}

#[tauri::command]
fn save_connection_settings(
    app: AppHandle,
    api_base_url: String,
    device_token: String,
) -> Result<ConnectionSettingsSummary, String> {
    WorkerConfig::save(&app, api_base_url, device_token)?;
    Ok(WorkerConfig::summary(&app))
}

#[tauri::command]
fn hide_current_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn show_worker_window(app: AppHandle) {
    show_window(&app, "main");
}

#[tauri::command]
fn get_start_with_windows(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_start_with_windows(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();

    if enabled {
        manager.enable().map_err(|error| error.to_string())?;
    } else {
        manager.disable().map_err(|error| error.to_string())?;
    }

    manager.is_enabled().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    let _ = dotenvy::from_path(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env.local"));

    let capture_shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::Numpad5);
    let worker_shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::NumLock);
    // Some Windows laptop keyboards report Ctrl+NumLock as the legacy Ctrl+Pause chord.
    let worker_pause_shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::Pause);
    let capture_for_handler = capture_shortcut.clone();
    let worker_for_handler = worker_shortcut.clone();
    let worker_pause_for_handler = worker_pause_shortcut.clone();
    let runtime = Arc::new(WorkerRuntime::new());

    tauri::Builder::default()
        .manage(runtime.clone())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app, "main");
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }

                    if shortcut == &capture_for_handler {
                        show_capture_window(app);
                    } else if shortcut == &worker_for_handler
                        || shortcut == &worker_pause_for_handler
                    {
                        toggle_window(app, "main");
                    }
                })
                .build(),
        )
        .setup(move |app| {
            app.global_shortcut().register(capture_shortcut.clone())?;
            app.global_shortcut().register(worker_shortcut.clone())?;
            if let Err(error) = app
                .global_shortcut()
                .register(worker_pause_shortcut.clone())
            {
                eprintln!("Could not register Ctrl+Pause fallback for Ctrl+NumLock: {error}");
            }
            setup_tray(app, runtime.clone())?;

            if std::env::args().any(|argument| argument == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            start_background_worker(app.handle().clone(), runtime.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                WindowEvent::Moved(position) if window.label() == "capture" => {
                    window_position::save(window.app_handle(), *position);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_for_work,
            get_worker_status,
            set_pause,
            create_capture,
            get_connection_settings,
            save_connection_settings,
            hide_current_window,
            show_worker_window,
            get_start_with_windows,
            set_start_with_windows,
            journal::list_journal_records,
            journal::create_journal_record,
            journal::update_journal_record,
            journal::delete_journal_record,
            journal::list_trashed_journal_records,
            journal::restore_journal_record,
            special::get_english_record,
            special::list_english_records,
            special::save_english_record,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
