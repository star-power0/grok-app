import { describe, expect, it } from "vitest";
import { snapshotModelMenuData } from "./ComposerModelMenu";

/**
 * Regression tests for the model-picker shake.
 *
 * The picker jittered because opening it did not freeze its inputs: the account
 * refresh, custom-provider hydration, catalog fetch and locale load each resolve
 * on their own schedule, and every one of them re-rendered the open panel with
 * different content, which re-measured and re-anchored it.
 *
 * These tests assert the open-time snapshot is a deep copy that later mutation
 * cannot reach, so geometry inputs are stable for as long as the panel is open.
 */

const labels = {
  model: "Model",
  effort: "Effort",
  effortHigh: "High",
  effortMedium: "Medium",
  effortLow: "Low",
  modelSearchPlaceholder: "Search models",
  modelSearchEmpty: "No matches",
  modelGroupOfficial: "Official",
};

function baseProps() {
  return {
    modelId: "grok-4",
    effort: "medium",
    models: [
      { id: "grok-4", label: "Grok 4" },
      { id: "grok-3", label: "Grok 3" },
    ],
    providers: [
      { id: "p1", name: "Local", model: "m1", models: [{ id: "m1", label: "M1" }] },
    ],
    activeSource: "official",
    activeProviderId: null,
    channelEfforts: [{ id: "low", label: "Low" }],
    applyNotes: { note: "restart required" },
    labels: { ...labels },
  } as unknown as Parameters<typeof snapshotModelMenuData>[0];
}

describe("snapshotModelMenuData", () => {
  it("captures the values present at open time", () => {
    const snapshot = snapshotModelMenuData(baseProps());
    expect(snapshot.modelId).toBe("grok-4");
    expect(snapshot.effort).toBe("medium");
    expect(snapshot.models.map((m) => m.id)).toEqual(["grok-4", "grok-3"]);
    expect(snapshot.providers.map((p) => p.id)).toEqual(["p1"]);
    expect(snapshot.labels.model).toBe("Model");
  });

  // A late catalog response used to change the row count of an open panel,
  // which changes its height and therefore its anchor.
  it("is not affected when the catalog array is mutated afterwards", () => {
    const props = baseProps();
    const snapshot = snapshotModelMenuData(props);

    props.models!.push({ id: "grok-5", label: "Grok 5" } as never);
    props.models![0]!.label = "renamed";

    expect(snapshot.models).toHaveLength(2);
    expect(snapshot.models[0]!.label).toBe("Grok 4");
  });

  // Custom-provider hydration arrives independently of the official catalog.
  it("is not affected when providers or their nested models are mutated", () => {
    const props = baseProps();
    const snapshot = snapshotModelMenuData(props);

    props.providers!.push({ id: "p2", name: "Remote", model: "m9" } as never);
    props.providers![0]!.models!.push({ id: "m2", label: "M2" } as never);
    props.providers![0]!.name = "renamed";

    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.providers[0]!.name).toBe("Local");
    expect(snapshot.providers[0]!.models).toHaveLength(1);
  });

  // Locale hydration changes label text, which changes measured panel width.
  it("is not affected when labels are mutated afterwards", () => {
    const props = baseProps();
    const snapshot = snapshotModelMenuData(props);

    props.labels.model = "模型";
    props.labels.modelSearchPlaceholder = "搜索模型（更长的中文占位文本）";

    expect(snapshot.labels.model).toBe("Model");
    expect(snapshot.labels.modelSearchPlaceholder).toBe("Search models");
  });

  it("is not affected when effort ladder or apply notes are mutated", () => {
    const props = baseProps();
    const snapshot = snapshotModelMenuData(props);

    props.channelEfforts!.push({ id: "max", label: "Max" } as never);
    (props.applyNotes as Record<string, string>).note = "changed";

    expect(snapshot.channelEfforts).toHaveLength(1);
    expect(snapshot.applyNotes).toEqual({ note: "restart required" });
  });

  // Route switches (official <-> custom) change which effort ladder renders,
  // so they must also be frozen.
  it("freezes the active route and provider id", () => {
    const props = baseProps();
    const snapshot = snapshotModelMenuData(props);

    props.activeSource = "custom";
    props.activeProviderId = "p1";

    expect(snapshot.activeSource).toBe("official");
    expect(snapshot.activeProviderId).toBeNull();
  });

  it("falls back to defaults instead of producing undefined geometry inputs", () => {
    const snapshot = snapshotModelMenuData({
      modelId: "grok-4",
      effort: "medium",
      labels: { ...labels },
    } as unknown as Parameters<typeof snapshotModelMenuData>[0]);

    expect(Array.isArray(snapshot.models)).toBe(true);
    expect(snapshot.models.length).toBeGreaterThan(0);
    expect(snapshot.providers).toEqual([]);
    expect(snapshot.activeSource).toBe("official");
    expect(snapshot.activeProviderId).toBeNull();
  });
});
