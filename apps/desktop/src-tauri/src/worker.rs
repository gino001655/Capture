use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::{config::WorkerConfig, processor};

#[derive(Deserialize)]
struct ClaimResponse {
    job: Option<Job>,
}

#[derive(Deserialize)]
struct JournalDeliveryClaimResponse {
    delivery: Option<JournalDelivery>,
}

#[derive(Deserialize)]
struct EnglishDeliveryClaimResponse {
    delivery: Option<EnglishDelivery>,
}

#[derive(Deserialize)]
struct TodoDeliveryClaimResponse {
    delivery: Option<TodoDelivery>,
}

#[derive(Deserialize)]
struct JournalDeliveryStatusResponse {
    delivery: JournalDeliveryStatus,
}

#[derive(Deserialize)]
struct EnglishDeliveryStatusResponse {
    delivery: EnglishDeliveryStatus,
}

#[derive(Deserialize)]
struct ReminderSummaryResponse {
    summary: ReminderSummary,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReminderSummary {
    pub(crate) continuation_count: usize,
    pub(crate) continuations: Vec<String>,
    pub(crate) journal_count: usize,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct EnglishDeliveryStatus {
    pub(crate) pending: usize,
    pub(crate) processing: usize,
    pub(crate) failed: usize,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JournalDeliveryStatus {
    pub(crate) pending_record_count: usize,
    pub(crate) processing_record_count: usize,
    pub(crate) failed_record_count: usize,
    pub(crate) dates: Vec<JournalDeliveryDateStatus>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JournalDeliveryDateStatus {
    pub(crate) journal_date: String,
    pub(crate) pending: usize,
    pub(crate) processing: usize,
    pub(crate) failed: usize,
    pub(crate) last_error: Option<String>,
    pub(crate) next_attempt_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalDelivery {
    attempt_id: String,
    journal_date: String,
    records: Vec<processor::JournalRecordForDelivery>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnglishDelivery {
    journal_date: String,
    payload: EnglishDeliveryPayload,
    processing_attempt_id: Option<String>,
}

#[derive(Deserialize)]
struct EnglishDeliveryPayload {
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TodoDelivery {
    attempt_id: String,
    record: TodoRecord,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TodoRecord {
    id: String,
    journal_date: String,
    areas: TodoAreas,
}

#[derive(Deserialize)]
struct TodoAreas {
    event: String,
}

#[derive(Deserialize)]
struct Job {
    id: String,
    content: String,
}

#[derive(Serialize)]
struct LegacyJobReportRequest<'a> {
    outcome: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

fn legacy_report(result: &Result<String, String>) -> LegacyJobReportRequest<'_> {
    match result {
        Ok(value) => LegacyJobReportRequest {
            outcome: "completed",
            result: Some(value),
            error: None,
        },
        Err(error) => LegacyJobReportRequest {
            outcome: "failed",
            result: None,
            error: Some(error),
        },
    }
}

#[derive(Serialize)]
struct JournalDeliveryReportRequest<'a> {
    outcome: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
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

const MAX_WORK_PER_CHECK: usize = 20;

#[derive(Debug, PartialEq, Eq)]
enum DrainAction {
    Continue,
    Stop,
}

fn drain_action(processed_count: usize, outcome: &str) -> DrainAction {
    if outcome == "processed" && processed_count < MAX_WORK_PER_CHECK {
        DrainAction::Continue
    } else {
        DrainAction::Stop
    }
}

async fn check_one(config: &WorkerConfig) -> Result<WorkerReport, String> {
    let client = Client::new();
    let journal_response = client
        .post(config.endpoint("api/journal-deliveries/claim"))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach the Journal delivery API: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Journal delivery claim failed: {error}"))?
        .json::<JournalDeliveryClaimResponse>()
        .await
        .map_err(|error| format!("Journal delivery claim response was invalid: {error}"))?;

    if let Some(delivery) = journal_response.delivery {
        let attempt_id = delivery.attempt_id.clone();
        let journal_date = delivery.journal_date.clone();
        let record_count = delivery.records.len();
        let process_date = journal_date.clone();
        let ai_provider = config.ai_provider.clone();
        let ai_model = config.ai_model.clone();
        let journal_ai_enabled = config.journal_ai_enabled;
        let process_result = tauri::async_runtime::spawn_blocking(move || {
            processor::process_journal_delivery(
                &process_date,
                &delivery.records,
                &ai_provider,
                ai_model.as_deref(),
                journal_ai_enabled,
            )
        })
        .await
        .map_err(|error| format!("The Journal processor stopped unexpectedly: {error}"))?;

        match process_result {
            Ok(result) => {
                report_journal_delivery(
                    &client,
                    config,
                    &attempt_id,
                    JournalDeliveryReportRequest {
                        outcome: "completed",
                        result: Some(&result),
                        error: None,
                    },
                )
                .await?;

                return Ok(WorkerReport {
                    outcome: "processed",
                    message: format!(
                        "Appended {record_count} Journal record(s) to Heptabase {journal_date}."
                    ),
                    job_id: Some(attempt_id),
                });
            }
            Err(error) => {
                let report_result = report_journal_delivery(
                    &client,
                    config,
                    &attempt_id,
                    JournalDeliveryReportRequest {
                        outcome: "failed",
                        result: None,
                        error: Some(&error),
                    },
                )
                .await;

                return match report_result {
                    Ok(()) => Err(format!(
                        "Journal delivery for {journal_date} failed and will retry: {error}"
                    )),
                    Err(report_error) => Err(format!(
                        "Journal delivery for {journal_date} failed: {error}. The failure could not be reported: {report_error}"
                    )),
                };
            }
        }
    }

    if config.todo_enabled {
        let todo_response = client
            .post(config.endpoint("api/todo-deliveries/claim"))
            .bearer_auth(&config.device_token)
            .send()
            .await
            .map_err(|error| format!("Could not reach the Todo delivery API: {error}"))?
            .error_for_status()
            .map_err(|error| format!("Todo delivery claim failed: {error}"))?
            .json::<TodoDeliveryClaimResponse>()
            .await
            .map_err(|error| format!("Todo delivery claim response was invalid: {error}"))?;
        if let Some(delivery) = todo_response.delivery {
            let attempt_id = delivery.attempt_id.clone();
            let date = delivery.record.journal_date.clone();
            let card_id = config
                .todo_card_id
                .clone()
                .ok_or_else(|| "Todo delivery is enabled without a card id.".to_owned())?;
            let result = tauri::async_runtime::spawn_blocking(move || {
                processor::append_todo(
                    &card_id,
                    &delivery.record.id,
                    &delivery.record.journal_date,
                    &delivery.record.areas.event,
                )
            })
            .await
            .map_err(|error| format!("The Todo processor stopped unexpectedly: {error}"))?;
            let report = match &result {
                Ok(value) => JournalDeliveryReportRequest {
                    outcome: "completed",
                    result: Some(value),
                    error: None,
                },
                Err(error) => JournalDeliveryReportRequest {
                    outcome: "failed",
                    result: None,
                    error: Some(error),
                },
            };
            report_todo_delivery(&client, config, &attempt_id, report).await?;
            return match result {
                Ok(_) => Ok(WorkerReport {
                    outcome: "processed",
                    message: format!("Appended {date} continuation to the Heptabase Todo card."),
                    job_id: Some(attempt_id),
                }),
                Err(error) => Err(format!(
                    "Todo delivery for {date} failed and will retry: {error}"
                )),
            };
        }
    }

    if config.anki_enabled {
        let english_response = client
            .post(config.endpoint("api/english-deliveries/claim"))
            .bearer_auth(&config.device_token)
            .send()
            .await
            .map_err(|error| format!("Could not reach the English delivery API: {error}"))?
            .error_for_status()
            .map_err(|error| format!("English delivery claim failed: {error}"))?
            .json::<EnglishDeliveryClaimResponse>()
            .await
            .map_err(|error| format!("English delivery claim response was invalid: {error}"))?;

        if let Some(delivery) = english_response.delivery {
            let attempt_id = delivery.processing_attempt_id.clone().ok_or_else(|| {
                "English delivery claim did not contain an attempt id.".to_owned()
            })?;
            let journal_date = delivery.journal_date.clone();
            let ai_provider = config.ai_provider.clone();
            let ai_model = config.ai_model.clone();
            let anki_connect_url = config.anki_connect_url.clone();
            let anki_deck = config.anki_deck.clone();
            let process_result = tauri::async_runtime::spawn_blocking(move || {
                processor::process_english_delivery(
                    &delivery.journal_date,
                    &delivery.payload.text,
                    &ai_provider,
                    ai_model.as_deref(),
                    &anki_connect_url,
                    &anki_deck,
                )
            })
            .await
            .map_err(|error| format!("The English processor stopped unexpectedly: {error}"))?;

            report_english_delivery(&client, config, &attempt_id, &process_result).await?;
            return match process_result {
                Ok(result) => Ok(WorkerReport {
                    outcome: "processed",
                    message: format!("Sent English {journal_date} to Anki: {result}"),
                    job_id: Some(attempt_id),
                }),
                Err(error) => Err(format!(
                    "English delivery for {journal_date} failed and will retry: {}",
                    error.message
                )),
            };
        }
    }

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

    let content = job.content.clone();
    let ai_provider = config.ai_provider.clone();
    let ai_model = config.ai_model.clone();
    let process_result = tauri::async_runtime::spawn_blocking(move || {
        processor::process_capture(&content, &ai_provider, ai_model.as_deref())
    })
    .await
    .map_err(|error| format!("The local processor stopped unexpectedly: {error}"))?;

    client
        .patch(config.endpoint(&format!("api/jobs/{}", job.id)))
        .bearer_auth(&config.device_token)
        .json(&legacy_report(&process_result))
        .send()
        .await
        .map_err(|error| format!("Could not report the result: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Result request failed: {error}"))?;

    if let Err(error) = process_result {
        return Err(format!("Capture processing failed and will retry: {error}"));
    }

    Ok(WorkerReport {
        outcome: "processed",
        message: format!("Saved capture to Heptabase: {}", job.content),
        job_id: Some(job.id),
    })
}

pub(crate) async fn check_for_work(config: &WorkerConfig) -> Result<WorkerReport, String> {
    let mut processed_count = 0;
    let mut last_job_id = None;

    loop {
        let report = check_one(config).await?;
        if report.outcome != "processed" {
            return if processed_count == 0 {
                Ok(report)
            } else {
                Ok(WorkerReport {
                    outcome: "processed",
                    message: format!("Processed {processed_count} queued item(s)."),
                    job_id: last_job_id,
                })
            };
        }

        processed_count += 1;
        last_job_id = report.job_id;
        if drain_action(processed_count, report.outcome) == DrainAction::Stop {
            return Ok(WorkerReport {
                outcome: "processed",
                message: format!(
                    "Processed {processed_count} queued item(s); more work may remain."
                ),
                job_id: last_job_id,
            });
        }
    }
}

async fn report_journal_delivery(
    client: &Client,
    config: &WorkerConfig,
    attempt_id: &str,
    report: JournalDeliveryReportRequest<'_>,
) -> Result<(), String> {
    client
        .patch(config.endpoint(&format!("api/journal-deliveries/{attempt_id}")))
        .bearer_auth(&config.device_token)
        .json(&report)
        .send()
        .await
        .map_err(|error| format!("Could not report the Journal delivery: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Journal delivery report failed: {error}"))?;

    Ok(())
}

async fn report_english_delivery(
    client: &Client,
    config: &WorkerConfig,
    attempt_id: &str,
    result: &Result<String, processor::EnglishProcessingFailure>,
) -> Result<(), String> {
    let report = match result {
        Ok(value) => JournalDeliveryReportRequest {
            outcome: "completed",
            result: Some(value),
            error: None,
        },
        Err(failure) => JournalDeliveryReportRequest {
            outcome: "failed",
            result: failure.receipt.as_deref(),
            error: Some(&failure.message),
        },
    };
    client
        .patch(config.endpoint(&format!("api/english-deliveries/{attempt_id}")))
        .bearer_auth(&config.device_token)
        .json(&report)
        .send()
        .await
        .map_err(|error| format!("Could not report the English delivery: {error}"))?
        .error_for_status()
        .map_err(|error| format!("English delivery report failed: {error}"))?;
    Ok(())
}

async fn report_todo_delivery(
    client: &Client,
    config: &WorkerConfig,
    attempt_id: &str,
    report: JournalDeliveryReportRequest<'_>,
) -> Result<(), String> {
    client
        .patch(config.endpoint(&format!("api/todo-deliveries/{attempt_id}")))
        .bearer_auth(&config.device_token)
        .json(&report)
        .send()
        .await
        .map_err(|error| format!("Could not report the Todo delivery: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Todo delivery report failed: {error}"))?;
    Ok(())
}

pub(crate) async fn get_journal_delivery_status(
    config: &WorkerConfig,
) -> Result<JournalDeliveryStatus, String> {
    Client::new()
        .get(config.endpoint("api/journal-deliveries"))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach the Journal delivery API: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Journal delivery status failed: {error}"))?
        .json::<JournalDeliveryStatusResponse>()
        .await
        .map(|response| response.delivery)
        .map_err(|error| format!("Journal delivery status response was invalid: {error}"))
}

pub(crate) async fn get_english_delivery_status(
    config: &WorkerConfig,
) -> Result<EnglishDeliveryStatus, String> {
    if !config.anki_enabled {
        return Ok(EnglishDeliveryStatus {
            pending: 0,
            processing: 0,
            failed: 0,
        });
    }
    Client::new()
        .get(config.endpoint("api/english-deliveries"))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach the English delivery API: {error}"))?
        .error_for_status()
        .map_err(|error| format!("English delivery status failed: {error}"))?
        .json::<EnglishDeliveryStatusResponse>()
        .await
        .map(|response| response.delivery)
        .map_err(|error| format!("English delivery status response was invalid: {error}"))
}

pub(crate) async fn get_reminder_summary(config: &WorkerConfig) -> Result<ReminderSummary, String> {
    Client::new()
        .get(config.endpoint("api/reminders/summary"))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach the reminder API: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Reminder summary failed: {error}"))?
        .json::<ReminderSummaryResponse>()
        .await
        .map(|response| response.summary)
        .map_err(|error| format!("Reminder summary response was invalid: {error}"))
}

pub(crate) async fn retry_failed_journal_deliveries(config: &WorkerConfig) -> Result<(), String> {
    let client = Client::new();
    client
        .post(config.endpoint("api/journal-deliveries"))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach the Journal delivery API: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Journal delivery retry request failed: {error}"))?;
    client
        .post(config.endpoint("api/jobs/retry"))
        .bearer_auth(&config.device_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach the legacy retry API: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Legacy retry request failed: {error}"))?;
    if config.anki_enabled {
        client
            .post(config.endpoint("api/english-deliveries"))
            .bearer_auth(&config.device_token)
            .send()
            .await
            .map_err(|error| format!("Could not reach the English retry API: {error}"))?
            .error_for_status()
            .map_err(|error| format!("English retry request failed: {error}"))?;
    }
    Ok(())
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
    use super::{drain_action, legacy_report, DrainAction, MAX_WORK_PER_CHECK};

    #[test]
    fn processor_failure_becomes_a_failed_cloud_report() {
        let process_result = Err("Codex is offline".to_owned());
        let report = serde_json::to_value(legacy_report(&process_result)).unwrap();

        assert_eq!(report["outcome"], "failed");
        assert_eq!(report["error"], "Codex is offline");
        assert!(report.get("result").is_none());
    }

    #[test]
    fn drain_continues_only_for_processed_work_below_the_bound() {
        assert_eq!(drain_action(1, "processed"), DrainAction::Continue);
        assert_eq!(drain_action(1, "idle"), DrainAction::Stop);
        assert_eq!(
            drain_action(MAX_WORK_PER_CHECK, "processed"),
            DrainAction::Stop
        );
    }
}
