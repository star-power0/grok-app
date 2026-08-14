//! Explicit input/continuation capabilities for a model.
//!
//! Legacy provider settings only contain `supports_vision`; their value is
//! mapped into `image_input` at the boundary so existing config remains valid.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilitySupport {
    Supported,
    Unsupported,
    Unknown,
}

impl Default for CapabilitySupport {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_input: Option<CapabilitySupport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video_input: Option<CapabilitySupport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_input: Option<CapabilitySupport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_input: Option<CapabilitySupport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_reference: Option<CapabilitySupport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_causal_continuation: Option<CapabilitySupport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_bound_continuation: Option<CapabilitySupport>,
}

impl ModelCapabilities {
    pub fn image_support(&self) -> CapabilitySupport {
        self.image_input.unwrap_or_default()
    }

    pub fn with_legacy_vision(mut self, supports_vision: Option<bool>) -> Self {
        if self.image_input.is_none() {
            self.image_input = supports_vision.map(|supported| {
                if supported {
                    CapabilitySupport::Supported
                } else {
                    CapabilitySupport::Unsupported
                }
            });
        }
        self
    }
}
