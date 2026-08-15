use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const DEFAULT_API_BASE_URL: &str = "http://localhost:3000";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkerConfig {
    pub(crate) api_base_url: String,
    pub(crate) device_token: String,
}

impl WorkerConfig {
    pub(crate) fn load(app: &AppHandle) -> Result<Self, String> {
        if let Ok(device_token) = env::var("CAPTURE_DEVICE_TOKEN") {
            let api_base_url = env::var("CAPTURE_API_BASE_URL")
                .unwrap_or_else(|_| DEFAULT_API_BASE_URL.to_owned());

            return Self::new(api_base_url, device_token);
        }

        let path = settings_path(app)?;
        let contents = fs::read_to_string(&path).map_err(|_| {
            "Desktop connection is not configured. Open Worker Status and save the API URL and Device Token."
                .to_owned()
        })?;
        let stored: Self = serde_json::from_str(&contents)
            .map_err(|error| format!("Desktop connection settings are invalid: {error}"))?;

        Self::new(stored.api_base_url, stored.device_token)
    }

    pub(crate) fn save(
        app: &AppHandle,
        api_base_url: String,
        device_token: String,
    ) -> Result<Self, String> {
        let config = Self::new(api_base_url, device_token)?;
        let path = settings_path(app)?;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create the settings directory: {error}"))?;
        }

        let contents = serde_json::to_string_pretty(&config)
            .map_err(|error| format!("Could not encode connection settings: {error}"))?;
        fs::write(&path, contents)
            .map_err(|error| format!("Could not save connection settings: {error}"))?;

        Ok(config)
    }

    pub(crate) fn summary(app: &AppHandle) -> ConnectionSettingsSummary {
        match Self::load(app) {
            Ok(config) => ConnectionSettingsSummary {
                api_base_url: config.api_base_url,
                token_configured: true,
                source: if env::var("CAPTURE_DEVICE_TOKEN").is_ok() {
                    "environment".to_owned()
                } else {
                    "saved".to_owned()
                },
            },
            Err(_) => ConnectionSettingsSummary {
                api_base_url: env::var("CAPTURE_API_BASE_URL")
                    .unwrap_or_else(|_| DEFAULT_API_BASE_URL.to_owned()),
                token_configured: false,
                source: "missing".to_owned(),
            },
        }
    }

    fn new(api_base_url: String, device_token: String) -> Result<Self, String> {
        let api_base_url = api_base_url.trim().trim_end_matches('/').to_owned();
        let device_token = device_token.trim().to_owned();

        if api_base_url.is_empty() {
            return Err("CAPTURE_API_BASE_URL cannot be empty.".to_owned());
        }

        if device_token.len() < 32 {
            return Err("CAPTURE_DEVICE_TOKEN must be at least 32 characters.".to_owned());
        }

        Ok(Self {
            api_base_url,
            device_token,
        })
    }

    pub(crate) fn endpoint(&self, path: &str) -> String {
        format!("{}/{}", self.api_base_url, path.trim_start_matches('/'))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionSettingsSummary {
    pub(crate) api_base_url: String,
    pub(crate) token_configured: bool,
    pub(crate) source: String,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("connection.json"))
        .map_err(|error| format!("Could not locate the application settings directory: {error}"))
}

#[cfg(test)]
mod tests {
    use super::WorkerConfig;

    #[test]
    fn worker_config_normalizes_the_api_base_url() {
        let config = WorkerConfig::new(
            " https://capture.example.com/ ".to_owned(),
            "a-secure-device-token-that-is-long-enough".to_owned(),
        )
        .expect("configuration should be valid");

        assert_eq!(
            config.endpoint("/api/jobs/claim"),
            "https://capture.example.com/api/jobs/claim"
        );
    }

    #[test]
    fn worker_config_rejects_a_short_device_token() {
        let result = WorkerConfig::new("http://localhost:3000".to_owned(), "too-short".to_owned());

        assert!(result.is_err());
    }

    #[test]
    fn worker_config_serializes_without_changing_the_token() {
        let config = WorkerConfig::new(
            "https://capture.example.com".to_owned(),
            "a-secure-device-token-that-is-long-enough".to_owned(),
        )
        .expect("configuration should be valid");

        let json = serde_json::to_string(&config).expect("configuration should serialize");
        let decoded: WorkerConfig =
            serde_json::from_str(&json).expect("configuration should deserialize");

        assert_eq!(decoded.api_base_url, "https://capture.example.com");
        assert_eq!(
            decoded.device_token,
            "a-secure-device-token-that-is-long-enough"
        );
    }
}
