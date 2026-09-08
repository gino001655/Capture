use std::path::Path;

/// Boundary between Capture's processors and an external knowledge destination.
///
/// A destination receives prepared Markdown and returns a stable human-readable
/// receipt. Implementations own credentials, retries, and destination-specific
/// concurrency checks; processors never import their SDKs directly.
pub(crate) trait CaptureDestination {
    fn create_note(&self, markdown_path: &Path) -> Result<String, String>;
    fn append_journal(
        &self,
        journal_date: &str,
        markdown: &str,
        record_count: usize,
    ) -> Result<String, String>;
}
