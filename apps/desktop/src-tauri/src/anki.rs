use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::ai_provider::{AnkiNote, AnkiUnresolved};

const MODEL_NAME: &str = "English_AI";
const MODEL_FIELDS: [&str; 6] = [
    "Prompt",
    "Answer",
    "Example",
    "Explanation",
    "Source",
    "Raw",
];

#[derive(Debug)]
pub(crate) struct AnkiSendFailure {
    pub(crate) message: String,
    pub(crate) receipt: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteReceipt {
    target: String,
    raw: String,
    outcome: &'static str,
    note_id: Option<i64>,
    reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryReceipt {
    deck: String,
    model: &'static str,
    journal_date: String,
    notes: Vec<NoteReceipt>,
    unresolved: Vec<AnkiUnresolved>,
    synced: bool,
    synced_at_unix_ms: Option<u128>,
}

pub(crate) fn send_notes(
    endpoint: &str,
    deck: &str,
    journal_date: &str,
    notes: &[AnkiNote],
    unresolved: Vec<AnkiUnresolved>,
) -> Result<String, AnkiSendFailure> {
    let client = Client::new();
    let mut receipt = DeliveryReceipt {
        deck: deck.to_owned(),
        model: MODEL_NAME,
        journal_date: journal_date.to_owned(),
        notes: Vec::with_capacity(notes.len()),
        unresolved,
        synced: false,
        synced_at_unix_ms: None,
    };

    invoke(&client, endpoint, "createDeck", json!({ "deck": deck }))
        .map_err(|message| failure(message, &receipt))?;
    ensure_model(&client, endpoint).map_err(|message| failure(message, &receipt))?;

    let date_tag = format!("capture_{}", journal_date.replace('-', "_"));
    for note in notes {
        let source_tag = format!(
            "capture_english_{}_{}",
            journal_date.replace('-', ""),
            stable_hash(&note.raw)
        );
        let target_tag = format!(
            "capture_target_{}",
            stable_hash(&canonical_target(&note.target))
        );

        let source_found = find_by_tag(&client, endpoint, &source_tag)
            .map_err(|message| failure(message, &receipt))?;
        let target_found = find_by_tag(&client, endpoint, &target_tag)
            .map_err(|message| failure(message, &receipt))?;
        if source_found || target_found {
            receipt.notes.push(NoteReceipt {
                target: note.target.clone(),
                raw: note.raw.clone(),
                outcome: "duplicate",
                note_id: None,
                reason: Some(if source_found {
                    "same source material already exists".to_owned()
                } else {
                    "equivalent normalized target already exists".to_owned()
                }),
            });
            continue;
        }

        let mut tags = vec![
            "capture".to_owned(),
            "english".to_owned(),
            date_tag.clone(),
            source_tag,
            target_tag,
        ];
        tags.extend(note.tags.iter().filter_map(|tag| normalize_tag(tag)));
        tags.sort();
        tags.dedup();
        let anki_note = json!({
            "deckName": deck,
            "modelName": MODEL_NAME,
            "fields": {
                "Prompt": to_anki_html(&note.prompt),
                "Answer": to_anki_html(&note.answer),
                "Example": to_anki_html(&note.example),
                "Explanation": to_anki_html(&note.explanation),
                "Source": to_anki_html(&note.source),
                "Raw": to_anki_html(&note.raw)
            },
            "options": { "allowDuplicate": false, "duplicateScope": "deck" },
            "tags": tags
        });

        let can_add = invoke(
            &client,
            endpoint,
            "canAddNotes",
            json!({ "notes": [anki_note.clone()] }),
        )
        .map_err(|message| failure(message, &receipt))?;
        if can_add
            .as_array()
            .and_then(|items| items.first())
            .and_then(Value::as_bool)
            != Some(true)
        {
            receipt.notes.push(NoteReceipt {
                target: note.target.clone(),
                raw: note.raw.clone(),
                outcome: "duplicate",
                note_id: None,
                reason: Some("Anki rejected this note as a duplicate".to_owned()),
            });
            continue;
        }

        let note_id = invoke(&client, endpoint, "addNote", json!({ "note": anki_note }))
            .map_err(|message| failure(message, &receipt))?
            .as_i64();
        receipt.notes.push(NoteReceipt {
            target: note.target.clone(),
            raw: note.raw.clone(),
            outcome: "added",
            note_id,
            reason: None,
        });
    }

    invoke(&client, endpoint, "sync", json!({})).map_err(|message| failure(message, &receipt))?;
    receipt.synced = true;
    receipt.synced_at_unix_ms = Some(now_unix_ms());
    serde_json::to_string(&receipt).map_err(|error| failure(error.to_string(), &receipt))
}

pub(crate) fn send_test_card(endpoint: &str, deck: &str) -> Result<String, String> {
    let client = Client::new();
    invoke(&client, endpoint, "createDeck", json!({ "deck": deck }))?;
    ensure_model(&client, endpoint)?;

    let timestamp = now_unix_ms();
    let note = test_note(deck, timestamp);
    let note_id = invoke(&client, endpoint, "addNote", json!({ "note": note }))?;
    invoke(&client, endpoint, "sync", json!({}))?;

    Ok(format!(
        "Added test card {} to {deck} and synced.",
        note_id
            .as_i64()
            .map_or_else(|| "(unknown id)".to_owned(), |id| id.to_string())
    ))
}

fn ensure_model(client: &Client, endpoint: &str) -> Result<(), String> {
    let models = invoke(client, endpoint, "modelNames", json!({}))?;
    let exists = models
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item == MODEL_NAME));
    if !exists {
        invoke(
            client,
            endpoint,
            "createModel",
            json!({
                "modelName": MODEL_NAME,
                "inOrderFields": MODEL_FIELDS,
                "css": ".card { font-family: Arial; font-size: 20px; text-align: left; color: black; background: white; } .answer { margin-top: 1rem; }",
                "isCloze": false,
                "cardTemplates": [{
                    "Name": "English",
                    "Front": "{{Prompt}}",
                    "Back": "{{FrontSide}}<hr id=answer><div class=answer>{{Answer}}</div><p>{{Example}}</p><p>{{Explanation}}</p><small>{{Source}}</small>"
                }]
            }),
        )?;
        return Ok(());
    }

    let fields = invoke(
        client,
        endpoint,
        "modelFieldNames",
        json!({ "modelName": MODEL_NAME }),
    )?;
    let actual = fields
        .as_array()
        .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    if actual != MODEL_FIELDS {
        return Err(format!(
            "Anki model '{MODEL_NAME}' has incompatible fields. Expected: {}.",
            MODEL_FIELDS.join(", ")
        ));
    }
    Ok(())
}

fn find_by_tag(client: &Client, endpoint: &str, tag: &str) -> Result<bool, String> {
    let found = invoke(
        client,
        endpoint,
        "findNotes",
        json!({ "query": format!("tag:{tag}") }),
    )?;
    Ok(found.as_array().is_some_and(|ids| !ids.is_empty()))
}

fn failure(message: String, receipt: &DeliveryReceipt) -> AnkiSendFailure {
    AnkiSendFailure {
        message,
        receipt: serde_json::to_string(receipt).unwrap_or_else(|_| "{}".to_owned()),
    }
}

fn test_note(deck: &str, timestamp: u128) -> Value {
    json!({
        "deckName": deck,
        "modelName": MODEL_NAME,
        "fields": {
            "Prompt": format!("Capture connection test {timestamp}"),
            "Answer": "Desktop → AnkiConnect → Anki is working. You can delete this card.",
            "Example": "",
            "Explanation": "Disposable integration test.",
            "Source": "Capture desktop",
            "Raw": "Capture connection test"
        },
        "options": { "allowDuplicate": false, "duplicateScope": "deck" },
        "tags": ["capture", "integration_test"]
    })
}

fn invoke(client: &Client, endpoint: &str, action: &str, params: Value) -> Result<Value, String> {
    let response = client
        .post(endpoint)
        .json(&json!({ "action": action, "version": 6, "params": params }))
        .send()
        .map_err(|error| format!("Could not reach AnkiConnect at {endpoint}: {error}"))?
        .error_for_status()
        .map_err(|error| format!("AnkiConnect HTTP request failed: {error}"))?
        .json::<Value>()
        .map_err(|error| format!("AnkiConnect returned invalid JSON: {error}"))?;
    if let Some(error) = response.get("error").and_then(Value::as_str) {
        if !error.is_empty() {
            return Err(format!("AnkiConnect {action} failed: {error}"));
        }
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| format!("AnkiConnect {action} response did not contain result."))
}

fn canonical_target(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn stable_hash(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn normalize_tag(tag: &str) -> Option<String> {
    let normalized = tag
        .trim()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '_' | '-' | ':') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    (!normalized.is_empty() && normalized.len() <= 80).then_some(normalized)
}

fn to_anki_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\n', "<br>")
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::{canonical_target, normalize_tag, stable_hash, test_note, to_anki_html};

    #[test]
    fn anki_fields_escape_html_and_hierarchical_tags_survive() {
        assert_eq!(to_anki_html("a < b\n& c"), "a &lt; b<br>&amp; c");
        assert_eq!(
            normalize_tag(" type::phrase ").as_deref(),
            Some("type::phrase")
        );
    }

    #[test]
    fn equivalent_targets_share_a_stable_identity() {
        assert_eq!(canonical_target(" Take   care "), "take care");
        assert_eq!(
            stable_hash("take care"),
            stable_hash(&canonical_target(" Take   care "))
        );
    }

    #[test]
    fn test_card_uses_the_real_model_and_is_clearly_disposable() {
        let note = test_note("English", 1234);
        assert_eq!(note["deckName"], "English");
        assert_eq!(note["modelName"], "English_AI");
        assert_eq!(note["fields"]["Prompt"], "Capture connection test 1234");
        assert!(note["fields"]["Answer"]
            .as_str()
            .is_some_and(|value| value.contains("delete this card")));
        assert_eq!(note["tags"][1], "integration_test");
    }
}
