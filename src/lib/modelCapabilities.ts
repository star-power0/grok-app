/**
 * Explicit model-input capability model.
 *
 * `supportsVision` remains the persisted legacy image flag. New callers may
 * provide this profile for modality-specific decisions without changing old
 * provider settings that only carry `supportsVision`.
 */
export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export type AttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "file"
  | "directory";

export interface ModelCapabilities {
  /** Direct image pixels / image content blocks. */
  imageInput?: CapabilitySupport;
  /** Direct video input, not a path reference. */
  videoInput?: CapabilitySupport;
  /** Direct audio input, not a path reference. */
  audioInput?: CapabilitySupport;
  /** Native document content input. */
  documentInput?: CapabilitySupport;
  /** Local file/directory references such as `@/path`. */
  fileReference?: CapabilitySupport;
  /** Can preserve an unfinished tool call/result causal chain. */
  toolCausalContinuation?: CapabilitySupport;
  /** Can continue facts that are bound to the originating provider. */
  providerBoundContinuation?: CapabilitySupport;
}

const capabilityValue = (
  value: CapabilitySupport | undefined,
): CapabilitySupport => value ?? "unknown";

/** Convert the persisted `supportsVision` flag into an explicit image capability. */
export function capabilitiesFromLegacyVision(
  supportsVision: boolean | undefined,
): ModelCapabilities {
  return {
    imageInput:
      supportsVision === undefined
        ? "unknown"
        : supportsVision
          ? "supported"
          : "unsupported",
  };
}

/** Explicit profile fields take precedence; legacy image capability fills gaps. */
export function mergeModelCapabilities(
  explicit: ModelCapabilities | undefined,
  supportsVision: boolean | undefined,
): ModelCapabilities {
  return {
    ...capabilitiesFromLegacyVision(supportsVision),
    ...explicit,
  };
}

export function capabilityForAttachmentKind(
  capabilities: ModelCapabilities | undefined,
  kind: AttachmentKind,
): CapabilitySupport {
  const c = capabilities ?? {};
  switch (kind) {
    case "image":
      return capabilityValue(c.imageInput);
    case "video":
      return capabilityValue(c.videoInput);
    case "audio":
      return capabilityValue(c.audioInput);
    case "document":
      return capabilityValue(c.documentInput);
    case "file":
    case "directory":
      return capabilityValue(c.fileReference);
  }
}

/** A legacy text-only target has explicitly rejected direct image input. */
export function isTextOnlyTarget(
  capabilities: ModelCapabilities | undefined,
): boolean {
  return capabilityValue(capabilities?.imageInput) === "unsupported";
}
