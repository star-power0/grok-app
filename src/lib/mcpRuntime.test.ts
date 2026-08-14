import { describe, expect, it } from "vitest";
import {
  applyMcpCatalog,
  applyMcpCatalogStale,
  applyMcpRuntimeSnapshot,
  applyMcpInitProgress,
  applyMcpInitialized,
  applyMcpServerStatus,
  countMcpPhases,
  EMPTY_MCP_SCOPE,
  shouldRefreshMcpCatalog,
  toRuntimePhase,
} from "./mcpRuntime";

const catalog = [
  { name: "alpha", transport: "stdio", target: "npx alpha", enabled: true },
  { name: "beta", transport: "http", target: "https://beta.example", enabled: true },
  { name: "gamma", transport: "stdio", target: "npx gamma", enabled: false },
];

describe("mcpRuntime", () => {
  it("starts configured servers as not connected, never ready", () => {
    const state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    expect(state.rows.map((r) => r.phase)).toEqual([
      "notConnected",
      "notConnected",
      "disabled",
    ]);
    expect(state.rows.every((r) => r.source === "config")).toBe(true);
  });

  it("moves enabled rows to initializing on session init progress", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpInitProgress(state, {
      sessionId: "s1",
      connected: 0,
      total: 2,
    });
    expect(state.rows[0]!.phase).toBe("initializing");
    expect(state.rows[2]!.phase).toBe("disabled");
    expect(state.initProgress).toEqual({ connected: 0, total: 2 });
  });

  it("applies per-server live status without touching other rows", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpInitProgress(state, { sessionId: "s1", total: 2 });
    state = applyMcpServerStatus(state, {
      sessionId: "s1",
      server: "alpha",
      status: "ready",
      toolCount: 4,
    });
    expect(state.rows[0]!).toMatchObject({
      phase: "ready",
      toolCount: 4,
      source: "session",
    });
    expect(state.rows[1]!.phase).toBe("initializing");
  });

  it("keeps unfinished servers unknown after initialization completes", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpInitProgress(state, { sessionId: "s1", total: 2 });
    state = applyMcpServerStatus(state, {
      sessionId: "s1",
      server: "alpha",
      status: "needsAuth",
      reason: "token expired",
    });
    state = applyMcpInitialized(state, { sessionId: "s1" });
    expect(state.rows[0]!.phase).toBe("needsAuth");
    expect(state.rows[0]!.reason).toBe("token expired");
    expect(state.rows[1]!.phase).toBe("unknown");
    expect(state.initialized).toBe(true);
  });

  it("preserves live phases across a catalog refresh in the same session", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpServerStatus(state, {
      sessionId: "s1",
      server: "alpha",
      status: "ready",
    });
    state = applyMcpCatalog(state, catalog, { sessionId: "s1" });
    expect(state.rows[0]!.phase).toBe("ready");
    expect(state.catalogStale).toBe(false);
  });

  it("resets live phases when another session takes over", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpServerStatus(state, {
      sessionId: "s1",
      server: "alpha",
      status: "ready",
    });
    state = applyMcpServerStatus(state, {
      sessionId: "s2",
      server: "beta",
      status: "unavailable",
    });
    expect(state.sessionId).toBe("s2");
    expect(state.rows[0]!.phase).toBe("notConnected");
    expect(state.rows[1]!.phase).toBe("unavailable");
  });

  it("ignores status for unknown servers and marks the catalog stale", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpServerStatus(state, {
      sessionId: "s1",
      server: "not-in-catalog",
      status: "ready",
    });
    expect(state.rows).toHaveLength(3);
    expect(state.rows.some((r) => r.phase === "ready")).toBe(false);
    expect(state.catalogStale).toBe(true);
  });

  it("drops events without a session or server name", () => {
    const state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    expect(applyMcpServerStatus(state, { server: "alpha", status: "ready" })).toBe(
      state,
    );
    expect(applyMcpServerStatus(state, { sessionId: "s1", status: "ready" })).toBe(
      state,
    );
    expect(applyMcpInitProgress(state, { total: 2 })).toBe(state);
  });

  it("coalesces repeated stale signals into one pending refresh", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpCatalogStale(state, { sessionId: "s1", kind: "tools_changed" });
    const once = state;
    state = applyMcpCatalogStale(state, {
      sessionId: "s1",
      kind: "servers_updated",
    });
    expect(state).toBe(once);
    expect(shouldRefreshMcpCatalog(state, { visible: true, fetching: false })).toBe(
      true,
    );
    expect(shouldRefreshMcpCatalog(state, { visible: false, fetching: false })).toBe(
      false,
    );
    expect(shouldRefreshMcpCatalog(state, { visible: true, fetching: true })).toBe(
      false,
    );
  });

  it("fetches once when no snapshot exists and not again while fresh", () => {
    expect(
      shouldRefreshMcpCatalog(EMPTY_MCP_SCOPE, { visible: true, fetching: false }),
    ).toBe(true);
    const state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    expect(shouldRefreshMcpCatalog(state, { visible: true, fetching: false })).toBe(
      false,
    );
  });

  it("replays missed startup status after the catalog is available", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, {
      sessionId: "s1",
      now: 1,
    });
    state = applyMcpRuntimeSnapshot(
      state,
      {
        sessionId: "s1",
        initialized: true,
        connected: 2,
        total: 2,
        servers: [
          {
            name: "alpha",
            status: "ready",
            toolCount: 4,
            observedAt: "2026-01-02T03:04:05Z",
          },
          { name: "beta", status: "needsAuth", reason: "expired" },
        ],
      },
      { now: 100 },
    );
    expect(state.initialized).toBe(true);
    expect(state.initProgress).toEqual({ connected: 2, total: 2 });
    expect(state.rows[0]).toMatchObject({
      phase: "ready",
      source: "session",
      toolCount: 4,
      observedAt: Date.parse("2026-01-02T03:04:05Z"),
    });
    expect(state.rows[1]).toMatchObject({
      phase: "needsAuth",
      reason: "expired",
      source: "session",
    });
    expect(state.rows[2]).toMatchObject({ phase: "disabled", source: "config" });
  });

  it("buffers status that arrives before catalog and projects it on refresh", () => {
    let state = applyMcpServerStatus(EMPTY_MCP_SCOPE, {
      sessionId: "s1",
      server: "alpha",
      status: "ready",
      toolCount: 3,
    }, { now: 10 });
    expect(state.rows).toEqual([]);
    expect(state.pendingServers.alpha).toMatchObject({
      status: "ready",
      toolCount: 3,
    });
    state = applyMcpCatalog(state, catalog, { sessionId: "s1", now: 20 });
    expect(state.rows[0]).toMatchObject({
      phase: "ready",
      source: "session",
      toolCount: 3,
    });
    expect(state.pendingServers.alpha).toBeUndefined();
  });

  it("keeps a newer live delta when an older snapshot arrives late", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpServerStatus(state, {
      sessionId: "s1",
      server: "alpha",
      status: "ready",
    }, { now: 200 });
    state = applyMcpRuntimeSnapshot(state, {
      sessionId: "s1",
      servers: [{
        name: "alpha",
        status: "unavailable",
        observedAt: new Date(100).toISOString(),
      }],
    }, { now: 300 });
    expect(state.rows[0]).toMatchObject({ phase: "ready", observedAt: 200 });
  });

  it("resets old evidence before applying another session snapshot", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpServerStatus(state, {
      sessionId: "s1",
      server: "alpha",
      status: "ready",
      toolCount: 2,
    });
    state = applyMcpRuntimeSnapshot(state, {
      sessionId: "s2",
      servers: [{ name: "beta", status: "unavailable", reason: "offline" }],
    }, { now: 10 });
    expect(state.sessionId).toBe("s2");
    expect(state.rows[0]).toMatchObject({
      phase: "notConnected",
      source: "config",
      reason: null,
    });
    expect(state.rows[1]).toMatchObject({
      phase: "unavailable",
      source: "session",
      reason: "offline",
    });
  });

  it("clears previous health when the same chat has a new ACP process", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpRuntimeSnapshot(state, {
      sessionId: "s1",
      processId: "proc-a",
      servers: [{ name: "alpha", status: "ready" }],
    }, { now: 10 });
    state = applyMcpRuntimeSnapshot(state, {
      sessionId: "s1",
      processId: "proc-b",
      servers: [{ name: "beta", status: "initializing" }],
    }, { now: 20 });
    expect(state.processId).toBe("proc-b");
    expect(state.rows[0]).toMatchObject({ phase: "notConnected", source: "config" });
    expect(state.rows[1]).toMatchObject({ phase: "initializing", source: "session" });
  });

  it("never invents a row for snapshot-only servers", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpRuntimeSnapshot(state, {
      sessionId: "s1",
      catalogStale: true,
      servers: [{ name: "not-configured", status: "ready" }],
    }, { now: 10 });
    expect(state.rows.map((row) => row.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(state.rows.every((row) => row.phase !== "ready")).toBe(true);
    expect(state.pendingServers["not-configured"]).toBeDefined();
    expect(state.catalogStale).toBe(true);
  });

  it("treats unrecognized wire status as unknown", () => {
    expect(toRuntimePhase("ready")).toBe("ready");
    expect(toRuntimePhase("weird-new-state")).toBe("unknown");
    expect(toRuntimePhase(null)).toBe("unknown");
  });

  it("counts phases for filter chips", () => {
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, catalog, { sessionId: "s1" });
    state = applyMcpServerStatus(state, {
      sessionId: "s1",
      server: "alpha",
      status: "ready",
    });
    const counts = countMcpPhases(state);
    expect(counts.ready).toBe(1);
    expect(counts.notConnected).toBe(1);
    expect(counts.disabled).toBe(1);
  });

  // Regression for the original `/mcp` complaint: every configured row showed
  // `unknown / notConnected` because the agent's startup lifecycle pushes land
  // before React subscribes. This replays the exact desktop wire order observed
  // against a local ACP agent reporting `firecrawl` ready with two tools.
  it("shows a configured server ready when its startup pushes precede the UI", () => {
    const configured = [
      { name: "firecrawl", transport: "stdio", target: "npx firecrawl", enabled: true },
      { name: "context7", transport: "http", target: "https://context7.example", enabled: true },
    ];

    // Startup pushes are emitted while the modal has no listener yet, so the
    // Host snapshot is the only surviving record of them.
    let state = applyMcpRuntimeSnapshot(
      EMPTY_MCP_SCOPE,
      {
        sessionId: "app-session-1",
        processId: "acp-1",
        initialized: true,
        connected: 1,
        total: 1,
        servers: [
          {
            name: "firecrawl",
            status: "ready",
            reason: "mock ready",
            toolCount: 2,
            observedAt: "2026-08-12T07:14:55.000Z",
          },
        ],
      },
      { now: 1_000 },
    );

    // No catalog yet: health is retained as evidence, never as an invented row.
    expect(state.rows).toEqual([]);
    expect(state.pendingServers.firecrawl?.status).toBe("ready");

    state = applyMcpCatalog(state, configured, { sessionId: "app-session-1" });

    const firecrawl = state.rows.find((row) => row.name === "firecrawl");
    expect(firecrawl?.phase).toBe("ready");
    expect(firecrawl?.source).toBe("session");
    expect(firecrawl?.toolCount).toBe(2);

    // A server the agent never reported must stay honest instead of borrowing
    // the healthy sibling's status.
    const context7 = state.rows.find((row) => row.name === "context7");
    expect(context7?.phase).toBe("notConnected");
    expect(context7?.source).toBe("config");
    expect(state.initialized).toBe(true);
    expect(countMcpPhases(state).ready).toBe(1);
  });

  it("keeps a cached agent list authoritative when it arrives after the catalog", () => {
    const configured = [
      { name: "firecrawl", transport: "stdio", target: "npx firecrawl", enabled: true },
    ];
    let state = applyMcpCatalog(EMPTY_MCP_SCOPE, configured, {
      sessionId: "app-session-1",
    });
    expect(state.rows[0]!.phase).toBe("notConnected");

    // `x.ai/mcp/list { cache: true }` correction on modal open.
    state = applyMcpRuntimeSnapshot(
      state,
      {
        sessionId: "app-session-1",
        processId: "acp-1",
        initialized: true,
        connected: 1,
        total: 1,
        servers: [
          { name: "firecrawl", status: "ready", reason: "mock ready", toolCount: 2 },
        ],
      },
      { now: 2_000 },
    );

    expect(state.rows[0]!.phase).toBe("ready");
    expect(state.rows[0]!.source).toBe("session");
    expect(state.rows[0]!.reason).toBe("mock ready");
  });
});
