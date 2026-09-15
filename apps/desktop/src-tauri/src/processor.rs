use serde::Deserialize;
use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::destination::CaptureDestination;

struct HeptabasePaths {
    heptabase_runtime: PathBuf,
    heptabase_cli_script: PathBuf,
}

#[derive(Deserialize)]
struct CreatedNote {
    id: String,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteReadResult {
    content: String,
    content_md5: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalReadResult {
    content: Value,
    content_md5: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalAppendResult {
    date: String,
    content_md5: String,
}

#[derive(Deserialize)]
pub(crate) struct JournalAreasForDelivery {
    unclassified: String,
    event: String,
    question: String,
    insight: String,
    next: String,
    feeling: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JournalRecordForDelivery {
    areas: JournalAreasForDelivery,
}

pub(crate) struct EnglishProcessingFailure {
    pub(crate) message: String,
    pub(crate) receipt: Option<String>,
}

impl From<String> for EnglishProcessingFailure {
    fn from(message: String) -> Self {
        Self {
            message,
            receipt: None,
        }
    }
}

pub(crate) fn process_capture(
    content: &str,
    ai_provider: &str,
    ai_model: Option<&str>,
) -> Result<String, String> {
    let provider = crate::ai_provider::AiProvider::load(ai_provider, ai_model)?;
    let destination = HeptabasePaths::discover()?;
    let note_path = temporary_note_path();

    let result = (|| {
        provider.write_markdown(content, &note_path)?;
        destination.create_note(&note_path)
    })();

    let _ = fs::remove_file(&note_path);
    result
}

pub(crate) fn process_english_delivery(
    journal_date: &str,
    text: &str,
    ai_provider: &str,
    ai_model: Option<&str>,
    anki_connect_url: &str,
    anki_deck: &str,
) -> Result<String, EnglishProcessingFailure> {
    if !is_journal_date(journal_date) || text.trim().is_empty() {
        return Err("English delivery requires a valid date and non-empty text."
            .to_owned()
            .into());
    }
    let provider = crate::ai_provider::AiProvider::load(ai_provider, ai_model)
        .map_err(EnglishProcessingFailure::from)?;
    let output = provider
        .create_anki_notes(text)
        .map_err(EnglishProcessingFailure::from)?;
    crate::anki::send_notes(
        anki_connect_url,
        anki_deck,
        journal_date,
        &output.notes,
        output.unresolved,
    )
    .map_err(|failure| EnglishProcessingFailure {
        message: failure.message,
        receipt: Some(failure.receipt),
    })
}

pub(crate) fn process_journal_delivery(
    journal_date: &str,
    records: &[JournalRecordForDelivery],
    ai_provider: &str,
    ai_model: Option<&str>,
    journal_ai_enabled: bool,
) -> Result<String, String> {
    if !is_journal_date(journal_date) {
        return Err("Journal delivery date must use YYYY-MM-DD.".to_owned());
    }

    let source_markdown = format_journal_records(records);
    if source_markdown.trim().is_empty() {
        return Err("Journal delivery contained no text.".to_owned());
    }

    let markdown = if journal_ai_enabled {
        let provider = crate::ai_provider::AiProvider::load(ai_provider, ai_model)?;
        let output_path = temporary_markdown_path("journal-ai");
        let result = (|| {
            provider.organize_journal_markdown(&source_markdown, &output_path)?;
            let output = fs::read_to_string(&output_path)
                .map_err(|error| format!("Could not read organized Journal Markdown: {error}"))?;
            if output.trim().is_empty() {
                return Err("Journal AI returned empty Markdown.".to_owned());
            }
            Ok(output.trim().to_owned())
        })();
        let _ = fs::remove_file(output_path);
        result?
    } else {
        source_markdown
    };

    HeptabasePaths::discover()?.append_journal(journal_date, &markdown, records.len())
}

pub(crate) fn create_todo_card() -> Result<String, String> {
    let destination = HeptabasePaths::discover()?;
    let note_path = temporary_markdown_path("todo-card");
    let result = (|| {
        ensure_heptabase_ready(&destination)?;
        fs::write(&note_path, "# Capture Todo\n")
            .map_err(|error| format!("Could not prepare the Todo card: {error}"))?;
        let note = create_heptabase_note(&destination, &note_path)?;
        Ok(note.id)
    })();
    let _ = fs::remove_file(note_path);
    result
}

pub(crate) fn append_todo(
    card_id: &str,
    record_id: &str,
    journal_date: &str,
    text: &str,
) -> Result<String, String> {
    if !is_journal_date(journal_date) || text.trim().is_empty() {
        return Err("Todo delivery requires a valid date and non-empty text.".to_owned());
    }
    let marker = todo_marker(record_id)?;
    let destination = HeptabasePaths::discover()?;
    ensure_heptabase_ready(&destination)?;
    let current = read_heptabase_note(&destination, card_id)?;
    if current.content.contains(&marker) {
        return Ok(format!("Todo already present ({marker})"));
    }
    let markdown = format_todo_markdown(journal_date, text, &marker)?;
    let note_path = temporary_markdown_path("todo-append");
    let result = (|| {
        fs::write(&note_path, markdown)
            .map_err(|error| format!("Could not prepare Todo Markdown: {error}"))?;
        append_heptabase_note(&destination, card_id, &note_path, &current.content_md5)?;
        Ok(format!("Todo appended ({marker})"))
    })();
    let _ = fs::remove_file(note_path);
    result
}

impl CaptureDestination for HeptabasePaths {
    fn create_note(&self, markdown_path: &Path) -> Result<String, String> {
        ensure_heptabase_ready(self)?;
        let note = create_heptabase_note(self, markdown_path)?;
        Ok(format!("Heptabase card {}: {}", note.id, note.title))
    }

    fn append_journal(
        &self,
        journal_date: &str,
        markdown: &str,
        record_count: usize,
    ) -> Result<String, String> {
        let note_path = temporary_markdown_path("journal");
        let result = (|| {
            ensure_heptabase_ready(self)?;
            let current = read_heptabase_journal(self, journal_date)?;
            let append_markdown = if journal_has_content(&current.content) {
                format!("---\n\n{markdown}")
            } else {
                markdown.to_owned()
            };
            fs::write(&note_path, append_markdown)
                .map_err(|error| format!("Could not prepare Journal Markdown: {error}"))?;
            let appended =
                append_heptabase_journal(self, journal_date, &note_path, &current.content_md5)?;
            Ok(format!(
                "Heptabase Journal {} contentMd5 {} ({} records)",
                appended.date, appended.content_md5, record_count
            ))
        })();
        let _ = fs::remove_file(&note_path);
        result
    }
}

impl HeptabasePaths {
    fn discover() -> Result<Self, String> {
        let local_app_data = env_path("LOCALAPPDATA")?;
        let directory = local_app_data.join("Programs").join("project-meta");
        let heptabase_runtime = directory.join("Heptabase.exe");
        let heptabase_cli_script = directory.join("resources").join("cli").join("cli.cjs");

        require_file(
            &heptabase_runtime,
            "Heptabase Desktop was not found in its standard installation directory.",
        )?;
        require_file(
            &heptabase_cli_script,
            "Heptabase CLI was not found. Enable it in Heptabase Settings > AI Features > CLI.",
        )?;

        Ok(Self {
            heptabase_runtime,
            heptabase_cli_script,
        })
    }
}

fn env_path(name: &str) -> Result<PathBuf, String> {
    env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| format!("Windows environment variable {name} is missing."))
}

fn require_file(path: &Path, message: &str) -> Result<(), String> {
    if path.is_file() {
        Ok(())
    } else {
        Err(format!("{message} Expected: {}", path.display()))
    }
}

fn create_heptabase_note(paths: &HeptabasePaths, note_path: &Path) -> Result<CreatedNote, String> {
    let mut command = heptabase_command(paths);
    command
        .args(["note", "create", "--content-file"])
        .arg(note_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|error| format!("Could not start Heptabase CLI: {error}"))?;
    if !output.status.success() {
        return Err(command_failure("Heptabase CLI", &output.stderr));
    }

    serde_json::from_slice::<CreatedNote>(&output.stdout)
        .map_err(|error| format!("Heptabase CLI returned invalid JSON: {error}"))
}

fn ensure_heptabase_ready(paths: &HeptabasePaths) -> Result<(), String> {
    let mut command = heptabase_command(paths);
    command
        .args(["start", "--timeout-ms", "60000"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|error| format!("Could not start Heptabase Desktop: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_failure("Heptabase Desktop startup", &output.stderr))
    }
}

fn read_heptabase_journal(
    paths: &HeptabasePaths,
    journal_date: &str,
) -> Result<JournalReadResult, String> {
    let mut command = heptabase_command(paths);
    command
        .args(["journal", "read", journal_date])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command
        .output()
        .map_err(|error| format!("Could not read the Heptabase Journal: {error}"))?;
    if !output.status.success() {
        return Err(command_failure("Heptabase Journal read", &output.stderr));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Heptabase Journal read returned invalid JSON: {error}"))
}

fn read_heptabase_note(paths: &HeptabasePaths, card_id: &str) -> Result<NoteReadResult, String> {
    let mut command = heptabase_command(paths);
    command
        .args(["note", "read", card_id])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command
        .output()
        .map_err(|error| format!("Could not read the Heptabase Todo card: {error}"))?;
    if !output.status.success() {
        return Err(command_failure("Heptabase Todo read", &output.stderr));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Heptabase Todo read returned invalid JSON: {error}"))
}

fn append_heptabase_note(
    paths: &HeptabasePaths,
    card_id: &str,
    note_path: &Path,
    content_md5: &str,
) -> Result<(), String> {
    let mut command = heptabase_command(paths);
    command
        .args(["note", "append", card_id, "--content-file"])
        .arg(note_path)
        .args(["--content-md5", content_md5])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command
        .output()
        .map_err(|error| format!("Could not append the Heptabase Todo card: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_failure("Heptabase Todo append", &output.stderr))
    }
}

fn append_heptabase_journal(
    paths: &HeptabasePaths,
    journal_date: &str,
    note_path: &Path,
    content_md5: &str,
) -> Result<JournalAppendResult, String> {
    let mut command = heptabase_command(paths);
    command
        .args(["journal", "append", journal_date, "--content-file"])
        .arg(note_path)
        .args(["--content-md5", content_md5])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command
        .output()
        .map_err(|error| format!("Could not append to the Heptabase Journal: {error}"))?;
    if !output.status.success() {
        return Err(command_failure("Heptabase Journal append", &output.stderr));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Heptabase Journal append returned invalid JSON: {error}"))
}

fn heptabase_command(paths: &HeptabasePaths) -> Command {
    let mut command = Command::new(&paths.heptabase_runtime);
    command
        .env("ELECTRON_RUN_AS_NODE", "1")
        .arg(&paths.heptabase_cli_script)
        .stdin(Stdio::null());
    hide_console_window(&mut command);
    command
}

fn command_failure(name: &str, stderr: &[u8]) -> String {
    let details = String::from_utf8_lossy(stderr);
    let details = details.trim();

    if details.is_empty() {
        format!("{name} failed without an error message.")
    } else {
        format!("{name} failed: {details}")
    }
}

fn temporary_note_path() -> PathBuf {
    temporary_markdown_path("note")
}

fn temporary_markdown_path(kind: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    env::temp_dir().join(format!(
        "personal-capture-{kind}-{}-{timestamp}.md",
        std::process::id()
    ))
}

fn is_journal_date(value: &str) -> bool {
    if value.len() != 10 {
        return false;
    }
    value.bytes().enumerate().all(|(index, byte)| {
        if index == 4 || index == 7 {
            byte == b'-'
        } else {
            byte.is_ascii_digit()
        }
    })
}

fn todo_marker(record_id: &str) -> Result<String, String> {
    let compact = record_id.replace('-', "");
    if compact.len() < 12 || !compact.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Todo record id must be a UUID-shaped hexadecimal value.".to_owned());
    }
    Ok(format!("Capture·{}", &compact[..12]))
}

fn format_todo_markdown(journal_date: &str, text: &str, marker: &str) -> Result<String, String> {
    let mut lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
    let first = lines
        .next()
        .ok_or_else(|| "Todo content cannot be empty.".to_owned())?;
    let compact_date = journal_date
        .get(5..)
        .unwrap_or(journal_date)
        .replace('-', "/");
    let mut markdown = format!("- [ ] {first}\n  - {compact_date} · {marker}");
    for line in lines {
        markdown.push_str("\n  - ");
        markdown.push_str(line.trim_start_matches(['-', '*', '+', ' ']));
    }
    markdown.push('\n');
    Ok(markdown)
}

fn format_journal_records(records: &[JournalRecordForDelivery]) -> String {
    records
        .iter()
        .filter_map(format_journal_record)
        .collect::<Vec<_>>()
        .join("\n\n---\n\n")
}

fn format_journal_record(record: &JournalRecordForDelivery) -> Option<String> {
    let areas = [
        (None, record.areas.unclassified.as_str()),
        // The persisted field names predate the user's symbolic semantics.
        // Keep the storage contract stable and interpret each slot by the
        // symbol shown in both clients: + 續, ? 疑, ~ 心, ! 悟, * 事.
        (Some("續"), record.areas.event.as_str()),
        (Some("疑"), record.areas.question.as_str()),
        (Some("心"), record.areas.insight.as_str()),
        (Some("悟"), record.areas.next.as_str()),
        (Some("事"), record.areas.feeling.as_str()),
    ];
    let formatted = areas
        .into_iter()
        .filter_map(|(label, content)| format_journal_area(label, content))
        .collect::<Vec<_>>();
    (!formatted.is_empty()).then(|| formatted.join("\n"))
}

fn format_journal_area(label: Option<&str>, content: &str) -> Option<String> {
    let lines = content
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return None;
    }
    if lines.len() == 1 && !is_markdown_list_item(lines[0].trim_start()) {
        return Some(match label {
            Some(label) => format!("- {label}：{}", lines[0].trim()),
            None => format!("- {}", lines[0].trim()),
        });
    }

    match label {
        Some(label) => {
            let details = lines
                .into_iter()
                .map(|line| {
                    if is_markdown_list_item(line.trim_start()) {
                        format!("  {line}")
                    } else {
                        format!("  - {}", line.trim())
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            Some(format!("- {label}：\n{details}"))
        }
        None => Some(
            lines
                .into_iter()
                .map(|line| format!("- {line}"))
                .collect::<Vec<_>>()
                .join("\n"),
        ),
    }
}

fn is_markdown_list_item(line: &str) -> bool {
    line.starts_with("- ")
        || line.starts_with("* ")
        || line.starts_with("+ ")
        || line.split_once(". ").is_some_and(|(number, _)| {
            !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn journal_has_content(value: &Value) -> bool {
    match value {
        Value::Array(items) => items.iter().any(journal_has_content),
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("text") {
                return object
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| !text.trim().is_empty());
            }
            if matches!(
                object.get("type").and_then(Value::as_str),
                Some("image" | "horizontalRule" | "table")
            ) {
                return true;
            }
            object.get("content").is_some_and(journal_has_content)
        }
        _ => false,
    }
}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::{
        command_failure, format_journal_records, format_todo_markdown, journal_has_content,
        todo_marker, CreatedNote, JournalAreasForDelivery, JournalRecordForDelivery,
    };
    use serde_json::json;

    #[test]
    fn heptabase_create_response_can_be_decoded() {
        let note: CreatedNote =
            serde_json::from_str(r#"{"id":"card-123","title":"Captured note"}"#)
                .expect("the response should decode");

        assert_eq!(note.id, "card-123");
        assert_eq!(note.title, "Captured note");
    }

    #[test]
    fn command_failure_includes_stderr() {
        assert_eq!(
            command_failure("Codex CLI", b"network unavailable\n"),
            "Codex CLI failed: network unavailable"
        );
    }

    #[test]
    fn todo_markdown_is_checkable_nested_and_idempotently_marked() {
        let marker = todo_marker("11111111-1111-4111-8111-111111111111").expect("marker");
        assert_eq!(marker, "Capture·111111111111");
        assert_eq!(
            format_todo_markdown("2026-09-15", "寄出文件\n- 確認附件", &marker).expect("markdown"),
            "- [ ] 寄出文件\n  - 09/15 · Capture·111111111111\n  - 確認附件\n"
        );
    }

    #[test]
    fn journal_records_use_the_approved_bullets_and_dividers() {
        let records = vec![
            JournalRecordForDelivery {
                areas: JournalAreasForDelivery {
                    unclassified: String::new(),
                    event: "買菜".to_owned(),
                    question: String::new(),
                    insight: "第一點\n第二點".to_owned(),
                    next: String::new(),
                    feeling: String::new(),
                },
            },
            JournalRecordForDelivery {
                areas: JournalAreasForDelivery {
                    unclassified: "純粹記下來".to_owned(),
                    event: String::new(),
                    question: String::new(),
                    insight: String::new(),
                    next: String::new(),
                    feeling: String::new(),
                },
            },
        ];

        assert_eq!(
            format_journal_records(&records),
            "- 續：買菜\n- 心：\n  - 第一點\n  - 第二點\n\n---\n\n- 純粹記下來"
        );
    }

    #[test]
    fn journal_formatter_preserves_user_list_nesting() {
        let records = vec![JournalRecordForDelivery {
            areas: JournalAreasForDelivery {
                unclassified: String::new(),
                event: String::new(),
                question: String::new(),
                insight: "- 第一點\n  - 內層\n2. 第二點".to_owned(),
                next: String::new(),
                feeling: String::new(),
            },
        }];

        assert_eq!(
            format_journal_records(&records),
            "- 心：\n  - 第一點\n    - 內層\n  2. 第二點"
        );
    }

    #[test]
    fn detects_empty_and_nonempty_prosemirror_documents() {
        assert!(!journal_has_content(&json!({
            "type": "doc",
            "content": [{ "type": "paragraph" }]
        })));
        assert!(journal_has_content(&json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{ "type": "text", "text": "existing" }]
            }]
        })));
    }
}
