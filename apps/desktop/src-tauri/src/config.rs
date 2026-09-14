use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const DEFAULT_API_BASE_URL: &str = "http://localhost:3000";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkerConfig {
    pub(crate) api_base_url: String,
    pub(crate) device_token: String,
    #[serde(default = "default_ai_provider")]
    pub(crate) ai_provider: String,
    #[serde(default)]
    pub(crate) ai_model: Option<String>,
    #[serde(default)]
    pub(crate) journal_ai_enabled: bool,
    #[serde(default)]
    pub(crate) anki_enabled: bool,
    #[serde(default = "default_anki_connect_url")]
    pub(crate) anki_connect_url: String,
    #[serde(default = "default_anki_deck")]
    pub(crate) anki_deck: String,
}

impl WorkerConfig {
    pub(crate) fn load(app: &AppHandle) -> Result<Self, String> {
        if let Ok(device_token) = env::var("CAPTURE_DEVICE_TOKEN") {
            let api_base_url = env::var("CAPTURE_API_BASE_URL")
                .unwrap_or_else(|_| DEFAULT_API_BASE_URL.to_owned());

            return Self::new(api_base_url, device_token)?
                .with_ai(
                    env::var("CAPTURE_AI_PROVIDER").unwrap_or_else(|_| default_ai_provider()),
                    env::var("CAPTURE_AI_MODEL").ok(),
                )?
                .with_automation(
                    env_flag("CAPTURE_JOURNAL_AI_ENABLED"),
                    env_flag("CAPTURE_ANKI_ENABLED"),
                    env::var("CAPTURE_ANKI_CONNECT_URL")
                        .unwrap_or_else(|_| default_anki_connect_url()),
                    env::var("CAPTURE_ANKI_DECK").unwrap_or_else(|_| default_anki_deck()),
                );
        }

        let path = settings_path(app)?;
        let contents = fs::read_to_string(&path).map_err(|_| {
            "Desktop connection is not configured. Open Worker Status and save the API URL and Device Token."
                .to_owned()
        })?;
        let stored: Self = serde_json::from_str(&contents)
            .map_err(|error| format!("Desktop connection settings are invalid: {error}"))?;

        Self::new(stored.api_base_url, stored.device_token)?
            .with_ai(stored.ai_provider, stored.ai_model)?
            .with_automation(
                stored.journal_ai_enabled,
                stored.anki_enabled,
                stored.anki_connect_url,
                stored.anki_deck,
            )
    }

    pub(crate) fn save(
        app: &AppHandle,
        api_base_url: String,
        device_token: String,
    ) -> Result<Self, String> {
        let config = Self::new(api_base_url, device_token)?;
        Self::persist(app, &config)?;
        Ok(config)
    }

    pub(crate) fn save_processing(
        app: &AppHandle,
        ai_provider: String,
        ai_model: Option<String>,
        journal_ai_enabled: bool,
        anki_enabled: bool,
        anki_connect_url: String,
        anki_deck: String,
    ) -> Result<Self, String> {
        let config = Self::load(app)?
            .with_ai(ai_provider, ai_model)?
            .with_automation(
                journal_ai_enabled,
                anki_enabled,
                anki_connect_url,
                anki_deck,
            )?;
        Self::persist(app, &config)?;
        Ok(config)
    }

    fn persist(app: &AppHandle, config: &Self) -> Result<(), String> {
        let path = settings_path(app)?;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create the settings directory: {error}"))?;
        }

        let contents = serde_json::to_string_pretty(&config)
            .map_err(|error| format!("Could not encode connection settings: {error}"))?;
        fs::write(&path, contents)
            .map_err(|error| format!("Could not save connection settings: {error}"))?;

        Ok(())
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
                ai_provider: config.ai_provider,
                ai_model: config.ai_model,
                journal_ai_enabled: config.journal_ai_enabled,
                anki_enabled: config.anki_enabled,
                anki_connect_url: config.anki_connect_url,
                anki_deck: config.anki_deck,
            },
            Err(_) => ConnectionSettingsSummary {
                api_base_url: env::var("CAPTURE_API_BASE_URL")
                    .unwrap_or_else(|_| DEFAULT_API_BASE_URL.to_owned()),
                token_configured: false,
                source: "missing".to_owned(),
                ai_provider: env::var("CAPTURE_AI_PROVIDER")
                    .unwrap_or_else(|_| default_ai_provider()),
                ai_model: env::var("CAPTURE_AI_MODEL").ok(),
                journal_ai_enabled: env_flag("CAPTURE_JOURNAL_AI_ENABLED"),
                anki_enabled: env_flag("CAPTURE_ANKI_ENABLED"),
                anki_connect_url: env::var("CAPTURE_ANKI_CONNECT_URL")
                    .unwrap_or_else(|_| default_anki_connect_url()),
                anki_deck: env::var("CAPTURE_ANKI_DECK").unwrap_or_else(|_| default_anki_deck()),
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
            ai_provider: default_ai_provider(),
            ai_model: None,
            journal_ai_enabled: false,
            anki_enabled: false,
            anki_connect_url: default_anki_connect_url(),
            anki_deck: default_anki_deck(),
        })
    }

    fn with_ai(mut self, provider: String, model: Option<String>) -> Result<Self, String> {
        self.ai_provider = match provider.trim().to_ascii_lowercase().as_str() {
            "codex-cli" => "codex-cli".to_owned(),
            "none" => "none".to_owned(),
            _ => return Err("AI provider must be codex-cli or none.".to_owned()),
        };
        self.ai_model = model
            .map(|model| model.trim().to_owned())
            .filter(|model| !model.is_empty());
        Ok(self)
    }

    fn with_automation(
        mut self,
        journal_ai_enabled: bool,
        anki_enabled: bool,
        anki_connect_url: String,
        anki_deck: String,
    ) -> Result<Self, String> {
        let anki_connect_url = anki_connect_url.trim().trim_end_matches('/').to_owned();
        if anki_connect_url != "http://127.0.0.1:8765"
            && anki_connect_url != "http://localhost:8765"
        {
            return Err(
                "AnkiConnect URL must be http://127.0.0.1:8765 or http://localhost:8765."
                    .to_owned(),
            );
        }
        let anki_deck = match anki_deck.trim() {
            // Pre-release migration: the approved workflow uses the top-level
            // English deck rather than the old Capture::English default.
            "Capture::English" => default_anki_deck(),
            value => value.to_owned(),
        };
        if anki_deck.is_empty() || anki_deck.len() > 200 {
            return Err("Anki deck must contain 1 to 200 characters.".to_owned());
        }
        self.journal_ai_enabled = journal_ai_enabled;
        self.anki_enabled = anki_enabled;
        self.anki_connect_url = anki_connect_url;
        self.anki_deck = anki_deck;
        Ok(self)
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
    pub(crate) ai_provider: String,
    pub(crate) ai_model: Option<String>,
    pub(crate) journal_ai_enabled: bool,
    pub(crate) anki_enabled: bool,
    pub(crate) anki_connect_url: String,
    pub(crate) anki_deck: String,
}

fn default_ai_provider() -> String {
    "codex-cli".to_owned()
}

fn default_anki_connect_url() -> String {
    "http://127.0.0.1:8765".to_owned()
}

fn default_anki_deck() -> String {
    "English".to_owned()
}

fn env_flag(name: &str) -> bool {
    env::var(name).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
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

    #[test]
    fn legacy_settings_default_to_codex_without_a_model() {
        let decoded: WorkerConfig = serde_json::from_str(
            r#"{"apiBaseUrl":"https://capture.example.com","deviceToken":"a-secure-device-token-that-is-long-enough"}"#,
        )
        .expect("legacy configuration should deserialize");

        assert_eq!(decoded.ai_provider, "codex-cli");
        assert_eq!(decoded.ai_model, None);
    }

    #[test]
    fn processing_settings_are_validated_and_normalized() {
        let config = WorkerConfig::new(
            "https://capture.example.com".to_owned(),
            "a-secure-device-token-that-is-long-enough".to_owned(),
        )
        .expect("configuration")
        .with_ai("CODEX-CLI".to_owned(), Some("  gpt-example  ".to_owned()))
        .expect("processing settings");

        assert_eq!(config.ai_provider, "codex-cli");
        assert_eq!(config.ai_model.as_deref(), Some("gpt-example"));
        assert!(config.with_ai("arbitrary-shell".to_owned(), None).is_err());
    }

    #[test]
    fn automation_settings_are_opt_in_and_restrict_anki_to_loopback() {
        let config = WorkerConfig::new(
            "https://capture.example.com".to_owned(),
            "a-secure-device-token-that-is-long-enough".to_owned(),
        )
        .expect("configuration")
        .with_automation(
            true,
            true,
            " http://localhost:8765/ ".to_owned(),
            " Capture::English ".to_owned(),
        )
        .expect("automation settings");
        assert!(config.journal_ai_enabled);
        assert!(config.anki_enabled);
        assert_eq!(config.anki_connect_url, "http://localhost:8765");
        assert_eq!(config.anki_deck, "English");
        assert!(config
            .with_automation(
                false,
                true,
                "https://example.com".to_owned(),
                "Deck".to_owned()
            )
            .is_err());
    }
}
