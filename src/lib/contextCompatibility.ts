/**
 * Pure preflight for preserving session context across sends and model changes.
 *
 * This validator does not rewrite prompts, summarize attachments, or discard
 * history. A caller must surface its blockers or warnings and choose an
 * explicit recovery flow.
 */
import {
  capabilityForAttachmentKind,
  type AttachmentKind,
  type CapabilitySupport,
  type ModelCapabilities,
} from "./modelCapabilities";

export type CompatibilityAction = "send" | "model_transition";
export type CompatibilitySeverity = "blocker" | "warning";

export type ContextCompatibilityCode =
  | "image_requires_vision"
  | "unsupported_attachment_kind"
  | "unknown_attachment_capability"
  | "incomplete_tool_causal_group"
  | "provider_bound_continuation";

export interface ContextCompatibilityFinding {
  severity: CompatibilitySeverity;
  code: ContextCompatibilityCode;
  message: string;
  attachmentPath?: string;
  attachmentKind?: AttachmentKind;
  toolCallId?: string;
  sourceProviderId?: string;
  targetProviderId?: string;
}

export interface ContextCompatibilityResult {
  action: CompatibilityAction;
  blockers: ContextCompatibilityFinding[];
  warnings: ContextCompatibilityFinding[];
  compatible: boolean;
}

export interface ContextAttachment {
  path: string;
  kind: AttachmentKind;
  /** `true` when direct media/document content must survive the transition. */
  requiresDirectInput?: boolean;
}

export interface ToolCausalGroup {
  toolCallId: string;
  /** Whether the call and its terminal result are both available. */
  complete: boolean;
}

export interface ProviderBoundContinuation {
  sourceProviderId: string;
  /** A continuation fact is provider-bound unless it was made portable explicitly. */
  portable?: boolean;
}

export interface ContextCompatibilityInput {
  action: CompatibilityAction;
  target: {
    providerId?: string | null;
    capabilities?: ModelCapabilities;
  };
  currentProviderId?: string | null;
  pendingAttachments?: ContextAttachment[];
  historyAttachments?: ContextAttachment[];
  toolCausalGroups?: ToolCausalGroup[];
  providerBoundContinuations?: ProviderBoundContinuation[];
}

const directInputRequired = (attachment: ContextAttachment): boolean =>
  attachment.requiresDirectInput ??
  (attachment.kind === "image" ||
    attachment.kind === "video" ||
    attachment.kind === "audio" ||
    attachment.kind === "document");

function supportsOrWarns(
  capability: CapabilitySupport,
  attachment: ContextAttachment,
  findings: ContextCompatibilityFinding[],
): void {
  if (!directInputRequired(attachment) || capability === "supported") return;

  if (capability === "unsupported") {
    findings.push({
      severity: "blocker",
      code:
        attachment.kind === "image"
          ? "image_requires_vision"
          : "unsupported_attachment_kind",
      message:
        attachment.kind === "image"
          ? "The target model is text-only and cannot receive this image."
          : `The target model does not support ${attachment.kind} input.`,
      attachmentPath: attachment.path,
      attachmentKind: attachment.kind,
    });
    return;
  }

  findings.push({
    severity: "warning",
    code: "unknown_attachment_capability",
    message: `The target model's ${attachment.kind} input capability is unknown; media will not be converted or dropped automatically.`,
    attachmentPath: attachment.path,
    attachmentKind: attachment.kind,
  });
}

/**
 * Validate pending and replayed context before a send or a model transition.
 * The result is structured for GUI/Host presentation; it is intentionally free
 * of side effects so it can be adopted at a single boundary later.
 */
export function validateContextCompatibility(
  input: ContextCompatibilityInput,
): ContextCompatibilityResult {
  const findings: ContextCompatibilityFinding[] = [];
  const seenAttachments = new Set<string>();
  for (const attachment of [
    ...(input.pendingAttachments ?? []),
    ...(input.historyAttachments ?? []),
  ]) {
    const key = `${attachment.path}\u0000${attachment.kind}\u0000${attachment.requiresDirectInput ?? "default"}`;
    if (seenAttachments.has(key)) continue;
    seenAttachments.add(key);
    supportsOrWarns(
      capabilityForAttachmentKind(input.target.capabilities, attachment.kind),
      attachment,
      findings,
    );
  }

  for (const group of input.toolCausalGroups ?? []) {
    if (group.complete) continue;
    findings.push({
      severity: "blocker",
      code: "incomplete_tool_causal_group",
      message: "The conversation has an active or incomplete tool call/result group that cannot be safely continued.",
      toolCallId: group.toolCallId,
    });
  }

  const targetProviderId = input.target.providerId?.trim() || undefined;
  const currentProviderId = input.currentProviderId?.trim() || undefined;
  const providerChanged =
    input.action === "model_transition" &&
    !!targetProviderId &&
    !!currentProviderId &&
    targetProviderId !== currentProviderId;
  if (providerChanged) {
    for (const fact of input.providerBoundContinuations ?? []) {
      if (fact.portable || fact.sourceProviderId === targetProviderId) continue;
      findings.push({
        severity: "blocker",
        code: "provider_bound_continuation",
        message: "The target provider cannot safely continue provider-bound conversation facts without an explicit portable handoff.",
        sourceProviderId: fact.sourceProviderId,
        targetProviderId,
      });
    }
  }

  return {
    action: input.action,
    blockers: findings.filter((finding) => finding.severity === "blocker"),
    warnings: findings.filter((finding) => finding.severity === "warning"),
    compatible: !findings.some((finding) => finding.severity === "blocker"),
  };
}
