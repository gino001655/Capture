use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::config::WorkerConfig;

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
struct CreateCaptureRequest<'a> {
    content: &'a str,
}

#[derive(Deserialize)]
struct CreateCaptureResponse {
    capture: CreatedCapture,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatedCapture {
    pub(crate) id: String,
    pub(crate) content: String,
    pub(crate) status: String,
}

pub(crate) struct WorkerReport {
    pub(crate) outcome: &'static str,
    pub(crate) message: String,
    pub(crate) job_id: Option<String>,
}

fn fake_process(content: &str) -> String {
    format!("Processed: {content}")
}

pub(crate) async fn check_for_work(config: &WorkerConfig) -> Result<WorkerReport, String> {
    let client = Client::new();
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

pub(crate) async fn create_capture(
    config: &WorkerConfig,
    content: &str,
) -> Result<CreatedCapture, String> {
    let response = Client::new()
        .post(config.endpoint("api/captures"))
        .bearer_auth(&config.device_token)
        .json(&CreateCaptureRequest { content })
        .send()
        .await
        .map_err(|error| format!("Could not reach the API: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Capture request failed: {error}"))?
        .json::<CreateCaptureResponse>()
        .await
        .map_err(|error| format!("Capture response was invalid: {error}"))?;

    Ok(response.capture)
}

#[cfg(test)]
mod tests {
    use super::fake_process;

    #[test]
    fn fake_processor_returns_a_deterministic_result() {
        assert_eq!(fake_process("Buy milk"), "Processed: Buy milk");
    }
}
