import { describe, expect, it } from "vitest";
import {
  validateContextCompatibility,
  type ContextCompatibilityInput,
} from "./contextCompatibility";
import {
  capabilitiesFromLegacyVision,
  mergeModelCapabilities,
} from "./modelCapabilities";

const input = (
  overrides: Partial<ContextCompatibilityInput> = {},
): ContextCompatibilityInput => ({
  action: "send",
  target: {
    providerId: "target",
    capabilities: { imageInput: "supported" },
  },
  pendingAttachments: [],
  historyAttachments: [],
  toolCausalGroups: [],
  providerBoundContinuations: [],
  ...overrides,
});

describe("context compatibility", () => {
  it("blocks a pending image for a text-only target without mutating it", () => {
    const pendingAttachments = [
      { path: "/tmp/screenshot.png", kind: "image" as const },
    ];
    const result = validateContextCompatibility(
      input({
        target: { providerId: "text", capabilities: { imageInput: "unsupported" } },
        pendingAttachments,
      }),
    );

    expect(result.compatible).toBe(false);
    expect(result.blockers).toMatchObject([
      {
        code: "image_requires_vision",
        attachmentPath: "/tmp/screenshot.png",
        attachmentKind: "image",
      },
    ]);
    expect(pendingAttachments).toEqual([
      { path: "/tmp/screenshot.png", kind: "image" },
    ]);
  });

  it("checks history media and distinguishes unsupported from unknown kinds", () => {
    const result = validateContextCompatibility(
      input({
        target: {
          capabilities: {
            videoInput: "unsupported",
            documentInput: "unknown",
          },
        },
        historyAttachments: [
          { path: "/tmp/demo.mp4", kind: "video" },
          { path: "/tmp/brief.pdf", kind: "document" },
        ],
      }),
    );

    expect(result.blockers.map((finding) => finding.code)).toEqual([
      "unsupported_attachment_kind",
    ]);
    expect(result.warnings.map((finding) => finding.code)).toEqual([
      "unknown_attachment_capability",
    ]);
  });

  it("blocks incomplete tool causal groups", () => {
    const result = validateContextCompatibility(
      input({
        toolCausalGroups: [
          { toolCallId: "call-open", complete: false },
          { toolCallId: "call-finished", complete: true },
        ],
      }),
    );

    expect(result.compatible).toBe(false);
    expect(result.blockers).toMatchObject([
      {
        code: "incomplete_tool_causal_group",
        toolCallId: "call-open",
      },
    ]);
  });

  it("blocks provider-bound facts only for cross-provider transitions", () => {
    const result = validateContextCompatibility(
      input({
        action: "model_transition",
        currentProviderId: "source",
        target: { providerId: "target", capabilities: {} },
        providerBoundContinuations: [
          { sourceProviderId: "source" },
          { sourceProviderId: "source", portable: true },
          { sourceProviderId: "target" },
        ],
      }),
    );

    expect(result.blockers).toMatchObject([
      {
        code: "provider_bound_continuation",
        sourceProviderId: "source",
        targetProviderId: "target",
      },
    ]);

    const sameProvider = validateContextCompatibility(
      input({
        action: "model_transition",
        currentProviderId: "source",
        target: { providerId: "source", capabilities: {} },
        providerBoundContinuations: [{ sourceProviderId: "source" }],
      }),
    );
    expect(sameProvider.blockers).toEqual([]);
  });

  it("upgrades legacy supportsVision without overwriting an explicit profile", () => {
    expect(capabilitiesFromLegacyVision(false)).toEqual({
      imageInput: "unsupported",
    });
    expect(mergeModelCapabilities({ imageInput: "supported" }, false)).toEqual({
      imageInput: "supported",
    });
  });
});
