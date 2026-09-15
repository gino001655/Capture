use serde::{Deserialize, Serialize};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::{config::WorkerConfig, worker};

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReminderState {
    daily_day: Option<i64>,
    weekly_day: Option<i64>,
}

struct TaipeiClock {
    day: i64,
    hour: u64,
    sunday: bool,
}

fn taipei_clock(unix_seconds: u64) -> TaipeiClock {
    let shifted = unix_seconds + 8 * 60 * 60;
    let day = (shifted / 86_400) as i64;
    let hour = shifted % 86_400 / 3_600;
    // 1970-01-01 was Thursday; Sunday is zero.
    let sunday = (day + 4).rem_euclid(7) == 0;
    TaipeiClock { day, hour, sunday }
}

pub(crate) async fn maybe_send(app: &AppHandle, config: &WorkerConfig) -> Result<(), String> {
    if !config.desktop_reminders_enabled {
        return Ok(());
    }
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let clock = taipei_clock(seconds);
    if clock.hour < 20 {
        return Ok(());
    }
    let path = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not locate reminder state: {error}"))?
        .join("reminder-state.json");
    let mut state: ReminderState = fs::read_to_string(&path)
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default();
    let daily_due = state.daily_day != Some(clock.day);
    let weekly_due = clock.sunday && state.weekly_day != Some(clock.day);
    if !daily_due && !weekly_due {
        return Ok(());
    }
    let summary = worker::get_reminder_summary(config).await?;
    if daily_due && summary.continuation_count > 0 {
        let mut body = summary.continuations.join("、");
        if summary.continuation_count > summary.continuations.len() {
            body.push_str(&format!(
                "，另有 {} 件",
                summary.continuation_count - summary.continuations.len()
            ));
        }
        app.notification()
            .builder()
            .title(if weekly_due {
                "最近可以繼續，也來回顧一下"
            } else {
                "最近可以繼續"
            })
            .body(if weekly_due && summary.journal_count > 0 {
                format!("{body}。最近七天有 {} 條紀錄。", summary.journal_count)
            } else {
                body
            })
            .show()
            .map_err(|error| format!("Could not show reminder: {error}"))?;
    } else if weekly_due && summary.journal_count > 0 {
        app.notification()
            .builder()
            .title("來回顧一下這週")
            .body(format!("最近七天有 {} 條紀錄。", summary.journal_count))
            .show()
            .map_err(|error| format!("Could not show review reminder: {error}"))?;
    }
    if daily_due {
        state.daily_day = Some(clock.day);
    }
    if weekly_due {
        state.weekly_day = Some(clock.day);
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_vec(&state).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Could not save reminder state: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::taipei_clock;

    #[test]
    fn taipei_clock_uses_a_fixed_utc_plus_eight_day() {
        let clock = taipei_clock(3 * 86_400 + 12 * 3_600); // 1970-01-04 20:00 Taipei, Sunday
        assert_eq!(clock.hour, 20);
        assert!(clock.sunday);
    }
}
