//! Host-owned storage for complete tool results.
//!
//! Timeline events carry a short, redacted preview while the complete result is
//! stored under the owning App session. Callers address artifacts by an opaque
//! identifier only; no user supplied filesystem path is ever accepted here.

use std::fs;

use serde::Serialize;
use uuid::Uuid;

const PREVIEW_MAX_CHARS: usize = 4_000;
const READ_MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolArtifactPreview {
    pub artifact_ref: Option<String>,
    pub output_bytes: usize,
    pub detail: Option<String>,
    pub detail_truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolArtifactRead {
    pub content: String,
    pub truncated: bool,
    pub output_bytes: usize,
}

fn artifacts_dir(session_id: &str) -> Result<std::path::PathBuf, String> {
    let clean = session_id.trim();
    if clean.is_empty() || clean.contains(['/', '\\']) || clean.contains("..") {
        return Err("invalid session id".into());
    }
    let dir = crate::paths::session_dir(clean).join("tool-artifacts");
    fs::create_dir_all(&dir).map_err(|e| format!("create tool artifact directory: {e}"))?;
    Ok(dir)
}

fn artifact_file(session_id: &str, artifact_ref: &str) -> Result<std::path::PathBuf, String> {
    let clean = artifact_ref.trim();
    if clean.is_empty()
        || clean.len() > 96
        || !clean
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid tool artifact reference".into());
    }
    Ok(artifacts_dir(session_id)?.join(format!("{clean}.txt")))
}

fn prefix_chars(input: &str, limit: usize) -> String {
    input.chars().take(limit).collect()
}

/// Persist complete raw text and return a redacted timeline preview.
///
/// Empty output is intentionally not materialized. The preview is redacted for
/// UI/log safety, but the session-local artifact preserves the original result
/// so users can inspect exactly what their own tool returned.
pub fn persist_tool_output(session_id: &str, raw: &str) -> Result<ToolArtifactPreview, String> {
    if raw.is_empty() {
        return Ok(ToolArtifactPreview {
            artifact_ref: None,
            output_bytes: 0,
            detail: None,
            detail_truncated: false,
        });
    }

    let artifact_ref = format!("tool-{}", Uuid::new_v4().simple());
    let path = artifact_file(session_id, &artifact_ref)?;
    crate::store_lock::write_bytes_atomic(&path, raw.as_bytes())?;

    let output_bytes = raw.len();
    let detail_truncated = raw.chars().count() > PREVIEW_MAX_CHARS;
    let preview = prefix_chars(raw, PREVIEW_MAX_CHARS);
    Ok(ToolArtifactPreview {
        artifact_ref: Some(artifact_ref),
        output_bytes,
        detail: Some(crate::store::redact_text(&preview).trim_end().to_string()),
        detail_truncated,
    })
}

/// Read one artifact from the current session only. Output is capped so a tool
/// cannot make the GUI allocate an unbounded text buffer in a single IPC call.
pub fn read_tool_output(session_id: &str, artifact_ref: &str) -> Result<ToolArtifactRead, String> {
    let path = artifact_file(session_id, artifact_ref)?;
    let bytes = fs::read(&path).map_err(|_| "tool result artifact not found".to_string())?;
    let output_bytes = bytes.len();
    let slice = &bytes[..bytes.len().min(READ_MAX_BYTES)];
    let content = String::from_utf8_lossy(slice).to_string();
    Ok(ToolArtifactRead {
        content,
        truncated: output_bytes > READ_MAX_BYTES,
        output_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_like_artifact_refs() {
        assert!(artifact_file("session", "../secret").is_err());
        assert!(artifact_file("session", "a/b").is_err());
        assert!(artifact_file("session", "safe_ref-1").is_ok());
    }

    #[test]
    fn preview_is_char_safe_and_marks_truncation() {
        let raw = "界".repeat(PREVIEW_MAX_CHARS + 1);
        let preview = prefix_chars(&raw, PREVIEW_MAX_CHARS);
        assert_eq!(preview.chars().count(), PREVIEW_MAX_CHARS);
        assert!(raw.chars().count() > PREVIEW_MAX_CHARS);
    }
}
