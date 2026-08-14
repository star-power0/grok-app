//! Side-effect-free context compatibility preflight.
//!
//! The validator returns structured blockers and warnings before a turn is
//! dispatched or a model/provider transition occurs. It never rewrites a prompt
//! and never converts or drops attachments.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::model_capabilities::{CapabilitySupport, ModelCapabilities};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompatibilityAction {
    Send,
    ModelTransition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompatibilitySeverity {
    Blocker,
    Warning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentKind {
    Image,
    Video,
    Audio,
    Document,
    File,
    Directory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextCompatibilityCode {
    ImageRequiresVision,
    UnsupportedAttachmentKind,
    UnknownAttachmentCapability,
    IncompleteToolCausalGroup,
    ProviderBoundContinuation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCompatibilityFinding {
    pub severity: CompatibilitySeverity,
    pub code: ContextCompatibilityCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment_kind: Option<AttachmentKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_provider_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCompatibilityResult {
    pub action: CompatibilityAction,
    pub blockers: Vec<ContextCompatibilityFinding>,
    pub warnings: Vec<ContextCompatibilityFinding>,
    pub compatible: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextAttachment {
    pub path: String,
    pub kind: AttachmentKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_direct_input: Option<bool>,
}

impl ContextAttachment {
    fn requires_direct_input(&self) -> bool {
        self.requires_direct_input.unwrap_or(matches!(
            self.kind,
            AttachmentKind::Image
                | AttachmentKind::Video
                | AttachmentKind::Audio
                | AttachmentKind::Document
        ))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCausalGroup {
    pub tool_call_id: String,
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderBoundContinuation {
    pub source_provider_id: String,
    #[serde(default)]
    pub portable: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCompatibilityTarget {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub capabilities: ModelCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCompatibilityInput {
    pub action: CompatibilityAction,
    pub target: ContextCompatibilityTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_provider_id: Option<String>,
    #[serde(default)]
    pub pending_attachments: Vec<ContextAttachment>,
    #[serde(default)]
    pub history_attachments: Vec<ContextAttachment>,
    #[serde(default)]
    pub tool_causal_groups: Vec<ToolCausalGroup>,
    #[serde(default)]
    pub provider_bound_continuations: Vec<ProviderBoundContinuation>,
}

fn capability_for_attachment(
    capabilities: &ModelCapabilities,
    kind: AttachmentKind,
) -> CapabilitySupport {
    match kind {
        AttachmentKind::Image => capabilities.image_input.unwrap_or_default(),
        AttachmentKind::Video => capabilities.video_input.unwrap_or_default(),
        AttachmentKind::Audio => capabilities.audio_input.unwrap_or_default(),
        AttachmentKind::Document => capabilities.document_input.unwrap_or_default(),
        AttachmentKind::File | AttachmentKind::Directory => {
            capabilities.file_reference.unwrap_or_default()
        }
    }
}

fn attachment_kind_name(kind: AttachmentKind) -> &'static str {
    match kind {
        AttachmentKind::Image => "image",
        AttachmentKind::Video => "video",
        AttachmentKind::Audio => "audio",
        AttachmentKind::Document => "document",
        AttachmentKind::File => "file",
        AttachmentKind::Directory => "directory",
    }
}

fn normalized_id(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// Classify an attachment by extension.
///
/// Directories and unknown extensions are `File`/`Directory` rather than a
/// guessed media kind: a wrong media guess would fabricate a blocker, and a
/// wrong file guess only falls back to the file-reference capability.
pub fn classify_attachment(path: &str, is_dir: bool) -> AttachmentKind {
    if is_dir {
        return AttachmentKind::Directory;
    }
    let ext = path
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "heic" | "avif" => {
            AttachmentKind::Image
        }
        "mp4" | "mov" | "webm" | "mkv" | "avi" | "m4v" => AttachmentKind::Video,
        "mp3" | "wav" | "m4a" | "flac" | "ogg" | "opus" | "aac" => AttachmentKind::Audio,
        "pdf" | "docx" | "doc" | "pptx" | "ppt" | "xlsx" | "xls" | "odt" | "rtf" => {
            AttachmentKind::Document
        }
        _ => AttachmentKind::File,
    }
}

impl ContextAttachment {
    /// Build from a journal/composer attachment row.
    pub fn from_stored(path: &str, is_dir: bool) -> Self {
        Self {
            path: path.to_string(),
            kind: classify_attachment(path, is_dir),
            requires_direct_input: None,
        }
    }
}

/// Validate only. Callers must explicitly decide whether and how to recover.
pub fn validate_context_compatibility(
    input: &ContextCompatibilityInput,
) -> ContextCompatibilityResult {
    let mut all = Vec::new();
    let mut seen_attachments = HashSet::new();
    for attachment in input
        .pending_attachments
        .iter()
        .chain(input.history_attachments.iter())
    {
        let key = format!(
            "{}\u{0}{:?}\u{0}{:?}",
            attachment.path, attachment.kind, attachment.requires_direct_input
        );
        if !seen_attachments.insert(key) || !attachment.requires_direct_input() {
            continue;
        }
        match capability_for_attachment(&input.target.capabilities, attachment.kind) {
            CapabilitySupport::Supported => {}
            CapabilitySupport::Unsupported => {
                let (code, message) = if attachment.kind == AttachmentKind::Image {
                    (
                        ContextCompatibilityCode::ImageRequiresVision,
                        "The target model is text-only and cannot receive this image.".to_string(),
                    )
                } else {
                    (
                        ContextCompatibilityCode::UnsupportedAttachmentKind,
                        format!(
                            "The target model does not support {} input.",
                            attachment_kind_name(attachment.kind)
                        ),
                    )
                };
                all.push(ContextCompatibilityFinding {
                    severity: CompatibilitySeverity::Blocker,
                    code,
                    message,
                    attachment_path: Some(attachment.path.clone()),
                    attachment_kind: Some(attachment.kind),
                    tool_call_id: None,
                    source_provider_id: None,
                    target_provider_id: None,
                });
            }
            CapabilitySupport::Unknown => all.push(ContextCompatibilityFinding {
                severity: CompatibilitySeverity::Warning,
                code: ContextCompatibilityCode::UnknownAttachmentCapability,
                message: format!(
                    "The target model's {} input capability is unknown; media will not be converted or dropped automatically.",
                    attachment_kind_name(attachment.kind)
                ),
                attachment_path: Some(attachment.path.clone()),
                attachment_kind: Some(attachment.kind),
                tool_call_id: None,
                source_provider_id: None,
                target_provider_id: None,
            }),
        }
    }

    for group in &input.tool_causal_groups {
        if group.complete {
            continue;
        }
        all.push(ContextCompatibilityFinding {
            severity: CompatibilitySeverity::Blocker,
            code: ContextCompatibilityCode::IncompleteToolCausalGroup,
            message: "The conversation has an active or incomplete tool call/result group that cannot be safely continued.".into(),
            attachment_path: None,
            attachment_kind: None,
            tool_call_id: Some(group.tool_call_id.clone()),
            source_provider_id: None,
            target_provider_id: None,
        });
    }

    let current_provider = normalized_id(input.current_provider_id.as_deref());
    let target_provider = normalized_id(input.target.provider_id.as_deref());
    let provider_changed = input.action == CompatibilityAction::ModelTransition
        && current_provider.is_some()
        && target_provider.is_some()
        && current_provider != target_provider;
    if provider_changed {
        for fact in &input.provider_bound_continuations {
            if fact.portable || Some(fact.source_provider_id.trim()) == target_provider {
                continue;
            }
            all.push(ContextCompatibilityFinding {
                severity: CompatibilitySeverity::Blocker,
                code: ContextCompatibilityCode::ProviderBoundContinuation,
                message: "The target provider cannot safely continue provider-bound conversation facts without an explicit portable handoff.".into(),
                attachment_path: None,
                attachment_kind: None,
                tool_call_id: None,
                source_provider_id: Some(fact.source_provider_id.clone()),
                target_provider_id: target_provider.map(str::to_string),
            });
        }
    }

    let blockers = all
        .iter()
        .filter(|finding| finding.severity == CompatibilitySeverity::Blocker)
        .cloned()
        .collect::<Vec<_>>();
    let warnings = all
        .into_iter()
        .filter(|finding| finding.severity == CompatibilitySeverity::Warning)
        .collect::<Vec<_>>();
    ContextCompatibilityResult {
        action: input.action,
        compatible: blockers.is_empty(),
        blockers,
        warnings,
    }
}

/// Resolve the capabilities of `model_id` from provider configuration.
///
/// Absence of a declaration yields `Unknown`, never `Supported`: an unproven
/// capability must warn rather than let media reach a model that will reject it.
/// The legacy `supports_vision` flag is honoured through `with_legacy_vision`.
pub fn resolve_target_capabilities(model_id: Option<&str>) -> ContextCompatibilityTarget {
    let (provider_id, legacy_vision) = match crate::providers::list_custom_providers() {
        Ok(list) => {
            let picked = normalized_id(model_id);
            if list.active_source == "official" {
                // Official Grok models are natively multimodal.
                (Some("official".to_string()), Some(true))
            } else {
                let provider = picked.and_then(|id| {
                    list.providers
                        .iter()
                        .find(|p| p.id == id || p.model == id)
                        .or_else(|| {
                            list.active_provider_id
                                .as_deref()
                                .and_then(|active| list.providers.iter().find(|p| p.id == active))
                        })
                });
                match provider {
                    Some(p) => {
                        // A per-model override wins over the channel default.
                        let per_model = picked.and_then(|id| {
                            p.models
                                .iter()
                                .find(|m| m.id == id)
                                .and_then(|m| m.supports_vision)
                        });
                        (Some(p.id.clone()), per_model.or(Some(p.supports_vision)))
                    }
                    None => (list.active_provider_id.clone(), None),
                }
            }
        }
        Err(_) => (None, None),
    };
    ContextCompatibilityTarget {
        provider_id,
        capabilities: ModelCapabilities::default().with_legacy_vision(legacy_vision),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image_target(support: CapabilitySupport) -> ContextCompatibilityTarget {
        ContextCompatibilityTarget {
            provider_id: Some("target".into()),
            capabilities: ModelCapabilities {
                image_input: Some(support),
                ..ModelCapabilities::default()
            },
        }
    }

    #[test]
    fn blocks_image_for_text_only_target_without_dropping_it() {
        let input = ContextCompatibilityInput {
            action: CompatibilityAction::Send,
            target: image_target(CapabilitySupport::Unsupported),
            current_provider_id: None,
            pending_attachments: vec![ContextAttachment {
                path: "/tmp/design.png".into(),
                kind: AttachmentKind::Image,
                requires_direct_input: None,
            }],
            history_attachments: vec![],
            tool_causal_groups: vec![],
            provider_bound_continuations: vec![],
        };
        let result = validate_context_compatibility(&input);
        assert!(!result.compatible);
        assert_eq!(
            result.blockers[0].code,
            ContextCompatibilityCode::ImageRequiresVision
        );
        assert_eq!(
            result.blockers[0].attachment_path.as_deref(),
            Some("/tmp/design.png")
        );
        assert_eq!(input.pending_attachments.len(), 1);
    }

    #[test]
    fn blocks_unsupported_attachment_kind_and_warns_for_unknown() {
        let input = ContextCompatibilityInput {
            action: CompatibilityAction::Send,
            target: ContextCompatibilityTarget {
                provider_id: None,
                capabilities: ModelCapabilities {
                    video_input: Some(CapabilitySupport::Unsupported),
                    ..ModelCapabilities::default()
                },
            },
            current_provider_id: None,
            pending_attachments: vec![
                ContextAttachment {
                    path: "/tmp/demo.mp4".into(),
                    kind: AttachmentKind::Video,
                    requires_direct_input: None,
                },
                ContextAttachment {
                    path: "/tmp/note.pdf".into(),
                    kind: AttachmentKind::Document,
                    requires_direct_input: None,
                },
            ],
            history_attachments: vec![],
            tool_causal_groups: vec![],
            provider_bound_continuations: vec![],
        };
        let result = validate_context_compatibility(&input);
        assert_eq!(
            result.blockers[0].code,
            ContextCompatibilityCode::UnsupportedAttachmentKind
        );
        assert_eq!(
            result.warnings[0].code,
            ContextCompatibilityCode::UnknownAttachmentCapability
        );
    }

    #[test]
    fn blocks_active_tool_group_and_cross_provider_bound_facts() {
        let result = validate_context_compatibility(&ContextCompatibilityInput {
            action: CompatibilityAction::ModelTransition,
            target: image_target(CapabilitySupport::Supported),
            current_provider_id: Some("source".into()),
            pending_attachments: vec![],
            history_attachments: vec![],
            tool_causal_groups: vec![ToolCausalGroup {
                tool_call_id: "tool-1".into(),
                complete: false,
            }],
            provider_bound_continuations: vec![
                ProviderBoundContinuation {
                    source_provider_id: "source".into(),
                    portable: false,
                },
                ProviderBoundContinuation {
                    source_provider_id: "source".into(),
                    portable: true,
                },
            ],
        });
        assert_eq!(result.blockers.len(), 2);
        assert!(result
            .blockers
            .iter()
            .any(|finding| finding.code == ContextCompatibilityCode::IncompleteToolCausalGroup));
        assert!(result
            .blockers
            .iter()
            .any(|finding| finding.code == ContextCompatibilityCode::ProviderBoundContinuation));
    }

    #[test]
    fn legacy_vision_maps_to_explicit_image_capability() {
        assert_eq!(
            ModelCapabilities::default()
                .with_legacy_vision(Some(false))
                .image_support(),
            CapabilitySupport::Unsupported
        );
        assert_eq!(
            ModelCapabilities {
                image_input: Some(CapabilitySupport::Supported),
                ..ModelCapabilities::default()
            }
            .with_legacy_vision(Some(false))
            .image_support(),
            CapabilitySupport::Supported
        );
    }
}
