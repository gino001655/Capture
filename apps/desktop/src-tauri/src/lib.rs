use serde::{Deserialize, Serialize};
use std::env;

const DEFAULT_API_BASE_URL: &str = "http://localhost:3000";

struct WorkerConfig {
    api_base_url: String,
    device_token: String,
}

impl WorkerConfig {
    fn from_environment() -> Result<Self, String> {
        let api_base_url =
            env::var("CAPTURE_API_BASE_URL").unwrap_or_else(|_| DEFAULT_API_BASE_URL.to_owned());
        let device_token = env::var("CAPTURE_DEVICE_TOKEN")
            .map_err(|_| "CAPTURE_DEVICE_TOKEN is not configured.".to_owned())?;

        Self::new(api_base_url, device_token)
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

    fn endpoint(&self, path: &str) -> String {
        format!("{}/{}", self.api_base_url, path.trim_start_matches('/'))
    }
}

#[derive(Deserialize)]
struct ClaimResponse {
    job: Option<Job>,
}

#[derive(Deserialize)]
struct Job {
    id: String,
    content: String,
}

#[derive(Serialize)]
struct CompleteRequest {
    result: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerReport {
    outcome: &'static str,
    message: String,
    job_id: Option<String>,
}

fn fake_process(content: &str) -> String {
    format!("Processed: {content}")
}

#[tauri::command]
async fn check_for_work() -> Result<WorkerReport, String> {
    let config = WorkerConfig::from_environment()?;
    let client = reqwest::Client::new();
    let response = client
        .post(config.endpoint("api/jobs/claim"))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach the API: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Claim request failed: {error}"))?
        .json::<ClaimResponse>()
        .await
        .map_err(|error| format!("Claim response was invalid: {error}"))?;

    let Some(job) = response.job else {
        return Ok(WorkerReport {
            outcome: "idle",
            message: "No pending captures were found.".to_owned(),
            job_id: None,
        });
    };

    let result = fake_process(&job.content);

    client
        .patch(config.endpoint(&format!("api/jobs/{}", job.id)))
        .bearer_auth(&config.device_token)
        .json(&CompleteRequest { result })
        .send()
        .await
        .map_err(|error| format!("Could not report the result: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Result request failed: {error}"))?;

    Ok(WorkerReport {
        outcome: "processed",
        message: format!("Processed capture: {}", job.content),
        job_id: Some(job.id),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    let _ = dotenvy::from_path(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env.local"));

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![check_for_work])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{fake_process, WorkerConfig};

    #[test]
    fn fake_processor_returns_a_deterministic_result() {
        assert_eq!(fake_process("Buy milk"), "Processed: Buy milk");
    }

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
}
