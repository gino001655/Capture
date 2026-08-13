use serde::{Deserialize, Serialize};

const API_BASE_URL: &str = "http://localhost:3000";

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
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{API_BASE_URL}/api/jobs/claim"))
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
        .patch(format!("{API_BASE_URL}/api/jobs/{}", job.id))
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
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![check_for_work])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::fake_process;

    #[test]
    fn fake_processor_returns_a_deterministic_result() {
        assert_eq!(fake_process("Buy milk"), "Processed: Buy milk");
    }
}
