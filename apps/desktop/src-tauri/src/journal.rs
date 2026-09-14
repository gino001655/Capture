use reqwest::{Client, Method, Response};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::config::WorkerConfig;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JournalAreas {
    unclassified: String,
    event: String,
    question: String,
    insight: String,
    next: String,
    feeling: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JournalRecord {
    id: String,
    device_id: String,
    journal_date: String,
    areas: JournalAreas,
    delivery_state: String,
    editing_state: String,
    revision: u64,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    conflict_of: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    deleted_at: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JournalCreateInput {
    id: String,
    device_id: String,
    journal_date: String,
    areas: JournalAreas,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JournalUpdateInput {
    device_id: String,
    journal_date: String,
    areas: JournalAreas,
    editing_state: String,
    expected_revision: u64,
    conflict_record_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JournalDeleteInput {
    expected_revision: u64,
}

#[derive(Deserialize)]
struct JournalRecordResponse {
    record: JournalRecord,
}

#[derive(Deserialize)]
struct JournalListResponse {
    records: Vec<JournalRecord>,
}

#[derive(Deserialize)]
struct JournalMutationResponse {
    record: JournalRecord,
}

fn journal_collection_url(base_url: &str, date: &str) -> String {
    format!(
        "{}/api/journal-records?date={}",
        base_url.trim_end_matches('/'),
        date
    )
}

fn bearer_value(device_token: &str) -> String {
    format!("Bearer {}", device_token)
}

fn api_error_message(status: u16, body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")?
                .get("message")?
                .as_str()
                .map(str::to_owned)
        })
        .unwrap_or_else(|| format!("Journal API returned {status}."))
}

async fn decode_json<T: DeserializeOwned>(response: Response) -> Result<T, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Could not read Journal API response: {error}"))?;
    if !status.is_success() {
        return Err(api_error_message(status.as_u16(), &body));
    }
    serde_json::from_str(&body)
        .map_err(|error| format!("Journal API response was invalid: {error}"))
}

async fn send_json<B: Serialize, T: DeserializeOwned>(
    config: &WorkerConfig,
    method: Method,
    url: String,
    body: Option<&B>,
) -> Result<T, String> {
    let client = Client::new();
    let mut request = client
        .request(method, url)
        .header("Authorization", bearer_value(&config.device_token));
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Could not reach Journal API: {error}"))?;
    decode_json(response).await
}

#[tauri::command]
pub(crate) async fn list_journal_records(
    app: AppHandle,
    journal_date: String,
) -> Result<Vec<JournalRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response: JournalListResponse = send_json::<(), _>(
        &config,
        Method::GET,
        journal_collection_url(&config.api_base_url, &journal_date),
        None,
    )
    .await?;
    Ok(response.records)
}

#[tauri::command]
pub(crate) async fn create_journal_record(
    app: AppHandle,
    input: JournalCreateInput,
) -> Result<JournalRecord, String> {
    let config = WorkerConfig::load(&app)?;
    let response: JournalRecordResponse = send_json(
        &config,
        Method::POST,
        config.endpoint("api/journal-records"),
        Some(&input),
    )
    .await?;
    Ok(response.record)
}

#[tauri::command]
pub(crate) async fn update_journal_record(
    app: AppHandle,
    id: String,
    input: JournalUpdateInput,
) -> Result<JournalRecord, String> {
    let config = WorkerConfig::load(&app)?;
    let response: JournalMutationResponse = send_json(
        &config,
        Method::PATCH,
        config.endpoint(&format!("api/journal-records/{id}")),
        Some(&input),
    )
    .await?;
    Ok(response.record)
}

#[tauri::command]
pub(crate) async fn delete_journal_record(
    app: AppHandle,
    id: String,
    input: JournalDeleteInput,
) -> Result<(), String> {
    let config = WorkerConfig::load(&app)?;
    let client = Client::new();
    let response = client
        .request(
            Method::DELETE,
            config.endpoint(&format!("api/journal-records/{id}")),
        )
        .header("Authorization", bearer_value(&config.device_token))
        .json(&input)
        .send()
        .await
        .map_err(|error| format!("Could not reach Journal API: {error}"))?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    Err(api_error_message(status.as_u16(), &body))
}

#[tauri::command]
pub(crate) async fn list_trashed_journal_records(
    app: AppHandle,
) -> Result<Vec<JournalRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response: JournalListResponse = send_json::<(), _>(
        &config,
        Method::GET,
        config.endpoint("api/journal-records/trash"),
        None,
    )
    .await?;
    Ok(response.records)
}

#[tauri::command]
pub(crate) async fn restore_journal_record(
    app: AppHandle,
    id: String,
    input: JournalDeleteInput,
) -> Result<JournalRecord, String> {
    let config = WorkerConfig::load(&app)?;
    let response: JournalMutationResponse = send_json(
        &config,
        Method::POST,
        config.endpoint(&format!("api/journal-records/{id}/restore")),
        Some(&input),
    )
    .await?;
    Ok(response.record)
}

#[cfg(test)]
mod tests {
    use super::{api_error_message, bearer_value, journal_collection_url};

    #[test]
    fn journal_collection_url_uses_the_existing_api_base() {
        assert_eq!(
            journal_collection_url("https://capture-web-two.vercel.app", "2026-08-18"),
            "https://capture-web-two.vercel.app/api/journal-records?date=2026-08-18"
        );
    }

    #[test]
    fn bearer_value_keeps_the_saved_device_token_out_of_query_strings() {
        assert_eq!(
            bearer_value("secret-device-token"),
            "Bearer secret-device-token"
        );
    }

    #[test]
    fn api_error_prefers_the_server_message_and_keeps_status_as_fallback() {
        assert_eq!(
            api_error_message(409, r#"{"error":{"message":"Revision conflict."}}"#),
            "Revision conflict."
        );
        assert_eq!(
            api_error_message(503, "not-json"),
            "Journal API returned 503."
        );
    }
}
