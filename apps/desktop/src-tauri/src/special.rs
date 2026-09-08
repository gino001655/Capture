use reqwest::{Client, Method};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::config::WorkerConfig;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnglishPayload {
    schema_version: u8,
    text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnglishRecord {
    id: String,
    module_id: String,
    journal_date: String,
    payload: EnglishPayload,
    revision: u64,
    processing_state: String,
    created_at: String,
    updated_at: String,
    locked_at: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnglishSaveInput {
    journal_date: String,
    text: String,
    expected_revision: Option<u64>,
    client_updated_at: String,
}

#[derive(Deserialize)]
struct EnglishResponse {
    record: Option<EnglishRecord>,
}

#[derive(Deserialize)]
struct EnglishListResponse {
    records: Vec<EnglishRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkoutRecord {
    id: String,
    module_id: String,
    journal_date: String,
    payload: Value,
    revision: u64,
    processing_state: String,
    created_at: String,
    updated_at: String,
    locked_at: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkoutSaveInput {
    journal_date: String,
    payload: Value,
    expected_revision: Option<u64>,
    client_updated_at: String,
}

#[derive(Deserialize)]
struct WorkoutResponse {
    record: Option<WorkoutRecord>,
}

#[derive(Deserialize)]
struct WorkoutListResponse {
    records: Vec<WorkoutRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkoutLibraryRecord {
    id: String,
    module_id: String,
    payload: Value,
    revision: u64,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkoutLibrarySaveInput {
    payload: Value,
    expected_revision: Option<u64>,
}

#[derive(Deserialize)]
struct WorkoutLibraryResponse {
    record: Option<WorkoutLibraryRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FoodRecord {
    id: String,
    module_id: String,
    journal_date: String,
    payload: Value,
    revision: u64,
    processing_state: String,
    created_at: String,
    updated_at: String,
    locked_at: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FoodSaveInput {
    journal_date: String,
    payload: Value,
    expected_revision: Option<u64>,
    client_updated_at: String,
}

#[derive(Deserialize)]
struct FoodResponse {
    record: Option<FoodRecord>,
}

#[derive(Deserialize)]
struct FoodListResponse {
    records: Vec<FoodRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FoodLibraryRecord {
    id: String,
    module_id: String,
    payload: Value,
    revision: u64,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FoodLibrarySaveInput {
    payload: Value,
    expected_revision: Option<u64>,
}

#[derive(Deserialize)]
struct FoodLibraryResponse {
    record: Option<FoodLibraryRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveCommandResult<T> {
    record: Option<T>,
    conflict: bool,
}

#[derive(Deserialize)]
struct ApiRecordResponse<T> {
    record: Option<T>,
}

fn decode_save_body<T: DeserializeOwned>(
    status: u16,
    body: &str,
    api_name: &str,
) -> Result<SaveCommandResult<T>, String> {
    let parsed = serde_json::from_str::<Value>(body).ok();
    let is_revision_conflict = status == 409
        && parsed
            .as_ref()
            .and_then(|value| value.get("error"))
            .and_then(|error| error.get("code"))
            .and_then(Value::as_str)
            == Some("REVISION_CONFLICT");

    if !(200..300).contains(&status) && !is_revision_conflict {
        return Err(error_message(status, body));
    }
    serde_json::from_str::<ApiRecordResponse<T>>(body)
        .map(|payload| SaveCommandResult {
            record: payload.record,
            conflict: is_revision_conflict,
        })
        .map_err(|error| format!("{api_name} API response was invalid: {error}"))
}

async fn decode_save_response<T: DeserializeOwned>(
    response: reqwest::Response,
    api_name: &str,
) -> Result<SaveCommandResult<T>, String> {
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|error| error.to_string())?;
    decode_save_body(status, &body, api_name)
}

fn error_message(status: u16, body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")?
                .get("message")?
                .as_str()
                .map(str::to_owned)
        })
        .unwrap_or_else(|| format!("English API returned {status}."))
}

async fn request(
    config: &WorkerConfig,
    method: Method,
    url: String,
    body: Option<&EnglishSaveInput>,
) -> Result<Option<EnglishRecord>, String> {
    let client = Client::new();
    let mut request = client
        .request(method, url)
        .header("Authorization", format!("Bearer {}", config.device_token));
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Could not reach English API: {error}"))?;
    let status = response.status();
    let response_body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(error_message(status.as_u16(), &response_body));
    }
    serde_json::from_str::<EnglishResponse>(&response_body)
        .map(|payload| payload.record)
        .map_err(|error| format!("English API response was invalid: {error}"))
}

#[tauri::command]
pub(crate) async fn get_english_record(
    app: AppHandle,
    journal_date: String,
) -> Result<Option<EnglishRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let url = config.endpoint(&format!("api/special-records/english?date={journal_date}"));
    request(&config, Method::GET, url, None).await
}

#[tauri::command]
pub(crate) async fn list_english_records(app: AppHandle) -> Result<Vec<EnglishRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .get(config.endpoint("api/special-records/english"))
        .header("Authorization", format!("Bearer {}", config.device_token))
        .send()
        .await
        .map_err(|error| format!("Could not reach English API: {error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(error_message(status.as_u16(), &body));
    }
    serde_json::from_str::<EnglishListResponse>(&body)
        .map(|payload| payload.records)
        .map_err(|error| format!("English API response was invalid: {error}"))
}

#[tauri::command]
pub(crate) async fn save_english_record(
    app: AppHandle,
    input: EnglishSaveInput,
) -> Result<SaveCommandResult<EnglishRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .put(config.endpoint("api/special-records/english"))
        .bearer_auth(&config.device_token)
        .json(&input)
        .send()
        .await
        .map_err(|error| format!("Could not reach English API: {error}"))?;
    decode_save_response(response, "English").await
}

#[tauri::command]
pub(crate) async fn get_workout_record(
    app: AppHandle,
    journal_date: String,
) -> Result<Option<WorkoutRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .get(config.endpoint(&format!("api/special-records/workout?date={journal_date}")))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach Workout API: {error}"))?;
    decode_workout_response(response).await
}

#[tauri::command]
pub(crate) async fn list_workout_records(app: AppHandle) -> Result<Vec<WorkoutRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .get(config.endpoint("api/special-records/workout"))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach Workout API: {error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(error_message(status.as_u16(), &body));
    }
    serde_json::from_str::<WorkoutListResponse>(&body)
        .map(|payload| payload.records)
        .map_err(|error| format!("Workout API response was invalid: {error}"))
}

#[tauri::command]
pub(crate) async fn save_workout_record(
    app: AppHandle,
    input: WorkoutSaveInput,
) -> Result<SaveCommandResult<WorkoutRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .put(config.endpoint("api/special-records/workout"))
        .bearer_auth(&config.device_token)
        .json(&input)
        .send()
        .await
        .map_err(|error| format!("Could not reach Workout API: {error}"))?;
    decode_save_response(response, "Workout").await
}

async fn decode_workout_response(
    response: reqwest::Response,
) -> Result<Option<WorkoutRecord>, String> {
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(error_message(status.as_u16(), &body));
    }
    serde_json::from_str::<WorkoutResponse>(&body)
        .map(|payload| payload.record)
        .map_err(|error| format!("Workout API response was invalid: {error}"))
}

async fn decode_workout_library_response(
    response: reqwest::Response,
) -> Result<Option<WorkoutLibraryRecord>, String> {
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(error_message(status.as_u16(), &body));
    }
    serde_json::from_str::<WorkoutLibraryResponse>(&body)
        .map(|payload| payload.record)
        .map_err(|error| format!("Workout library API response was invalid: {error}"))
}

#[tauri::command]
pub(crate) async fn get_workout_library(
    app: AppHandle,
) -> Result<Option<WorkoutLibraryRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .get(config.endpoint("api/special-records/workout/library"))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach Workout library API: {error}"))?;
    decode_workout_library_response(response).await
}

#[tauri::command]
pub(crate) async fn save_workout_library(
    app: AppHandle,
    input: WorkoutLibrarySaveInput,
) -> Result<Option<WorkoutLibraryRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .put(config.endpoint("api/special-records/workout/library"))
        .bearer_auth(&config.device_token)
        .json(&input)
        .send()
        .await
        .map_err(|error| format!("Could not reach Workout library API: {error}"))?;
    decode_workout_library_response(response).await
}

async fn decode_food_response(response: reqwest::Response) -> Result<Option<FoodRecord>, String> {
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(error_message(status.as_u16(), &body));
    }
    serde_json::from_str::<FoodResponse>(&body)
        .map(|payload| payload.record)
        .map_err(|error| format!("Food API response was invalid: {error}"))
}

#[tauri::command]
pub(crate) async fn get_food_record(
    app: AppHandle,
    journal_date: String,
) -> Result<Option<FoodRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .get(config.endpoint(&format!("api/special-records/food?date={journal_date}")))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach Food API: {error}"))?;
    decode_food_response(response).await
}

#[tauri::command]
pub(crate) async fn list_food_records(app: AppHandle) -> Result<Vec<FoodRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .get(config.endpoint("api/special-records/food"))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach Food API: {error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(error_message(status.as_u16(), &body));
    }
    serde_json::from_str::<FoodListResponse>(&body)
        .map(|payload| payload.records)
        .map_err(|error| format!("Food API response was invalid: {error}"))
}

#[tauri::command]
pub(crate) async fn save_food_record(
    app: AppHandle,
    input: FoodSaveInput,
) -> Result<SaveCommandResult<FoodRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .put(config.endpoint("api/special-records/food"))
        .bearer_auth(&config.device_token)
        .json(&input)
        .send()
        .await
        .map_err(|error| format!("Could not reach Food API: {error}"))?;
    decode_save_response(response, "Food").await
}

async fn decode_food_library_response(
    response: reqwest::Response,
) -> Result<Option<FoodLibraryRecord>, String> {
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(error_message(status.as_u16(), &body));
    }
    serde_json::from_str::<FoodLibraryResponse>(&body)
        .map(|payload| payload.record)
        .map_err(|error| format!("Food library API response was invalid: {error}"))
}

#[tauri::command]
pub(crate) async fn get_food_library(app: AppHandle) -> Result<Option<FoodLibraryRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .get(config.endpoint("api/special-records/food/library"))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach Food library API: {error}"))?;
    decode_food_library_response(response).await
}

#[tauri::command]
pub(crate) async fn save_food_library(
    app: AppHandle,
    input: FoodLibrarySaveInput,
) -> Result<Option<FoodLibraryRecord>, String> {
    let config = WorkerConfig::load(&app)?;
    let response = Client::new()
        .put(config.endpoint("api/special-records/food/library"))
        .bearer_auth(&config.device_token)
        .json(&input)
        .send()
        .await
        .map_err(|error| format!("Could not reach Food library API: {error}"))?;
    decode_food_library_response(response).await
}

#[cfg(test)]
mod tests {
    use super::{decode_save_body, error_message};
    use serde_json::Value;

    #[test]
    fn english_api_error_prefers_server_message() {
        assert_eq!(
            error_message(409, r#"{"error":{"message":"locked"}}"#),
            "locked"
        );
    }

    #[test]
    fn revision_conflict_keeps_the_cloud_record_for_the_desktop_ui() {
        let result = decode_save_body::<Value>(
            409,
            r#"{"error":{"code":"REVISION_CONFLICT","message":"changed"},"record":{"revision":4}}"#,
            "English",
        )
        .expect("revision conflict is a successful structured command result");

        assert!(result.conflict);
        assert_eq!(result.record.unwrap()["revision"], 4);
    }
}
