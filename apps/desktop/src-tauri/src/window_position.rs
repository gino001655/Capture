use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, PhysicalPosition};

#[derive(Deserialize, Serialize)]
struct CaptureWindowPosition {
    x: i32,
    y: i32,
}

fn position_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("capture-window-position.json"))
        .map_err(|error| error.to_string())
}

pub(crate) fn save(app: &AppHandle, position: PhysicalPosition<i32>) {
    let Ok(path) = position_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let value = CaptureWindowPosition {
        x: position.x,
        y: position.y,
    };
    if let Ok(json) = serde_json::to_string(&value) {
        let _ = fs::write(path, json);
    }
}

pub(crate) fn restore(app: &AppHandle) {
    let Some(window) = app.get_webview_window("capture") else { return };
    let Ok(path) = position_path(app) else { return };
    let Ok(json) = fs::read_to_string(path) else { return };
    let Ok(position) = serde_json::from_str::<CaptureWindowPosition>(&json) else { return };
    let _ = window.set_position(PhysicalPosition::new(position.x, position.y));
}
