/**
 * MCP runtime status projection.
 *
 * The Host owns the truth: `mcp_catalog` reports configuration, and live ACP
 * notifications report runtime health. This module merges those into per-server
 * rows without ever inventing a healthy state — a server is only `ready` when a
 * live session said so.
 *
 * Ordering rules matter because notifications can arrive before the catalog, or
 * from a session the user is no longer viewing.
 */

export type McpRuntimePhase =
  | "disabled"
  | "notConnected"
  | "initializing"
  | "ready"
  | "needsAuth"
  | "unavailable"
  | "unknown";

export type McpCatalogRow = {
  name: string;
  transport?: string | null;
  target?: string | null;
  scope?: string | null;
  enabled?: boolean;
};

export type McpRuntimeRow = {
  name: string;
  transport?: string | null;
  target?: string | null;
  scope?: string | null;
  enabled: boolean;
  phase: McpRuntimePhase;
  reason?: string | null;
  toolCount?: number | null;
  /** Which source last set `phase` (config default vs live session). */
  source: "config" | "session";
  observedAt?: number;
};

/**
 * Runtime evidence received before its configuration row arrives.
 *
 * ACP initializes independently from the catalog request. Dropping these events
 * would recreate the exact startup race this state layer exists to prevent, but
 * rendering them as rows would invent configuration. Keep them briefly and
 * project them only if/when the matching catalog row is returned.
 */
type PendingMcpRuntimeServer = {
  status: string | null | undefined;
  reason?: string | null;
  toolCount?: number | null;
  observedAt?: number;
};

export type McpScopeState = {
  /** Session that owns the current live statuses, when any. */
  sessionId: string | null;
  /** ACP child generation that produced the current runtime evidence. */
  processId: string | null;
  catalogLoadedAt: number | null;
  catalogStale: boolean;
  initProgress: { connected: number | null; total: number | null } | null;
  initialized: boolean;
  rows: McpRuntimeRow[];
  /** Non-rendered runtime evidence awaiting a matching catalog row. */
  pendingServers: Record<string, PendingMcpRuntimeServer>;
};

export type McpServerStatusEvent = {
  sessionId?: string | null;
  /** ACP child generation that emitted this status, when the Host provides it. */
  processId?: string | null;
  server?: string | null;
  status?: string | null;
  reason?: string | null;
  toolCount?: number | null;
};

export type McpInitProgressEvent = {
  sessionId?: string | null;
  connected?: number | null;
  total?: number | null;
};

export type McpCatalogStaleEvent = {
  sessionId?: string | null;
  kind?: string | null;
  server?: string | null;
};

export const EMPTY_MCP_SCOPE: McpScopeState = {
  sessionId: null,
  processId: null,
  catalogLoadedAt: null,
  catalogStale: false,
  initProgress: null,
  initialized: false,
  rows: [],
  pendingServers: {},
};

/**
 * Start displaying another App session before its snapshot/catalog responses
 * arrive. Old configuration and health are deliberately removed rather than
 * briefly being attributed to the newly selected chat.
 */
export function beginMcpRuntimeSession(
  prev: McpScopeState,
  sessionId?: string | null,
): McpScopeState {
  const nextId = sessionId?.trim() || null;
  if (prev.sessionId === nextId && prev.rows.length === 0) return prev;
  return {
    ...EMPTY_MCP_SCOPE,
    sessionId: nextId,
  };
}

const KNOWN_PHASES: McpRuntimePhase[] = [
  "disabled",
  "notConnected",
  "initializing",
  "ready",
  "needsAuth",
  "unavailable",
  "unknown",
];

/** Coerce a wire status into a known phase; unknown never means healthy. */
export function toRuntimePhase(raw: string | null | undefined): McpRuntimePhase {
  const value = (raw || "").trim().toLowerCase();
  switch (value) {
    case "ready":
    case "connected":
    case "ok":
    case "healthy":
      return "ready";
    case "initializing":
    case "connecting":
    case "starting":
    case "pending":
      return "initializing";
    case "needsauth":
    case "needs_auth":
    case "unauthorized":
    case "auth_required":
    case "auth_expired":
      return "needsAuth";
    case "unavailable":
    case "failed":
    case "error":
    case "disconnected":
    case "exited":
      return "unavailable";
    case "disabled":
      return "disabled";
    case "notconnected":
    case "not_connected":
      return "notConnected";
    default:
      return (KNOWN_PHASES as string[]).includes(raw?.trim() ?? "")
        ? (raw!.trim() as McpRuntimePhase)
        : "unknown";
  }
}

function parseObservedAt(raw: string | null | undefined, fallback: number): number {
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Apply a fresh catalog snapshot.
 *
 * Live phases are preserved when the reporting session still matches, so a
 * routine catalog refresh cannot visually "disconnect" healthy servers.
 */
export function applyMcpRuntimeSnapshot(
  prev: McpScopeState,
  snapshot: {
    sessionId?: string | null;
    processId?: string | null;
    initialized?: boolean;
    connected?: number | null;
    total?: number | null;
    catalogStale?: boolean;
    servers?: Array<{
      name: string;
      status?: string | null;
      reason?: string | null;
      toolCount?: number | null;
      observedAt?: string | null;
    }>;
  },
  opts?: { now?: number },
): McpScopeState {
  const sessionId = (snapshot.sessionId || "").trim();
  if (!sessionId) return prev;
  const processId = (snapshot.processId || "").trim() || null;
  const now = opts?.now ?? Date.now();
  const sessionBase = withSessionReset(prev, sessionId);
  const base = withProcessReset(sessionBase, processId);
  const evidence = { ...base.pendingServers };
  const currentRows = new Map(base.rows.map((row) => [row.name, row]));
  for (const server of snapshot.servers ?? []) {
    const name = server.name.trim();
    if (!name) continue;
    const observedAt = parseObservedAt(server.observedAt, now);
    const existing = evidence[name];
    const current = currentRows.get(name);
    // A late snapshot must not regress a newer push event from this session.
    if (
      (existing?.observedAt != null && existing.observedAt > observedAt) ||
      (current?.source === "session" &&
        current.observedAt != null &&
        current.observedAt > observedAt)
    ) {
      continue;
    }
    evidence[name] = {
      status: server.status,
      reason: server.reason ?? null,
      toolCount: server.toolCount ?? null,
      observedAt,
    };
  }
  const pendingServers: Record<string, PendingMcpRuntimeServer> = {};
  const rows = base.rows.map((row) => {
    const live = evidence[row.name];
    if (!live) return row;
    if (row.enabled) {
      delete evidence[row.name];
      return {
        ...row,
        phase: toRuntimePhase(live.status),
        reason: live.reason ?? null,
        toolCount: live.toolCount ?? null,
        source: "session" as const,
        observedAt: live.observedAt ?? now,
      };
    }
    // A disabled catalog row stays disabled even if stale session data says ready.
    delete evidence[row.name];
    return row;
  });
  for (const [name, value] of Object.entries(evidence)) {
    pendingServers[name] = value;
  }
  return {
    ...base,
    // Older Host builds omit this compatibility field; preserve the known
    // generation in that case instead of discarding valid current evidence.
    processId: processId ?? base.processId,
    // Host snapshots are authoritative for this process. In particular, a new
    // init-progress event must be allowed to change a previously-ready scope
    // back to `initialized: false` instead of leaving stale completion visible.
    initialized: snapshot.initialized === true,
    // Keep a completed `connected/total` summary visible after initialization;
    // it is still useful evidence and lets the modal distinguish 0/0 from an
    // unavailable snapshot. A later init-progress event will replace it.
    initProgress:
      snapshot.connected != null || snapshot.total != null
        ? { connected: snapshot.connected ?? null, total: snapshot.total ?? null }
        : base.initProgress,
    catalogStale: snapshot.catalogStale === true || base.catalogStale,
    rows,
    pendingServers,
  };
}

export function applyMcpCatalog(
  prev: McpScopeState,
  catalog: McpCatalogRow[],
  opts?: { sessionId?: string | null; now?: number },
): McpScopeState {
  const now = opts?.now ?? Date.now();
  const sessionId = opts?.sessionId ?? prev.sessionId ?? null;
  const sameSession = !!sessionId && sessionId === prev.sessionId;
  const base =
    sessionId && !sameSession ? withSessionReset(prev, sessionId) : prev;
  const byName = new Map(base.rows.map((row) => [row.name, row]));
  const pending = sameSession ? { ...base.pendingServers } : {};

  const rows: McpRuntimeRow[] = catalog.map((entry) => {
    const enabled = entry.enabled !== false;
    const previous = byName.get(entry.name);
    const deferred = pending[entry.name];
    const keepLive =
      sameSession && (previous?.source === "session" || deferred != null);
    if (deferred) delete pending[entry.name];
    const phase: McpRuntimePhase = !enabled
      ? "disabled"
      : deferred
        ? toRuntimePhase(deferred.status)
        : keepLive
          ? previous!.phase
          : "notConnected";
    return {
      name: entry.name,
      transport: entry.transport ?? null,
      target: entry.target ?? null,
      scope: entry.scope ?? null,
      enabled,
      phase,
      reason: !enabled
        ? null
        : deferred
          ? (deferred.reason ?? null)
          : keepLive
            ? (previous?.reason ?? null)
            : null,
      toolCount: !enabled
        ? null
        : deferred
          ? (deferred.toolCount ?? null)
          : keepLive
            ? (previous?.toolCount ?? null)
            : null,
      source: enabled && keepLive ? "session" : "config",
      observedAt: enabled
        ? deferred?.observedAt ?? (keepLive ? previous?.observedAt : undefined)
        : undefined,
    };
  });

  return {
    ...base,
    sessionId,
    catalogLoadedAt: now,
    // This catalog request consumed the stale signal. Keep unmatched evidence
    // for a future manual/route refresh, but do not spin a visible-panel fetch
    // loop when the active session legitimately has a server outside this scope.
    catalogStale: false,
    initProgress: sameSession ? base.initProgress : null,
    initialized: sameSession ? base.initialized : false,
    rows,
    pendingServers: pending,
  };
}

function withSessionReset(
  prev: McpScopeState,
  sessionId: string,
): McpScopeState {
  if (prev.sessionId === sessionId) return prev;
  // A different session owns MCP runtime now; previous live phases no longer
  // describe reality. Config rows stay so the list does not flicker empty.
  return resetRuntimeEvidence(prev, sessionId, null);
}

function withProcessReset(
  prev: McpScopeState,
  processId: string | null,
): McpScopeState {
  if (!processId || !prev.processId || prev.processId === processId) return prev;
  // Same App session, fresh ACP child: all old ready/error evidence belongs to
  // the retired process. Keep configuration but require new lifecycle evidence.
  return resetRuntimeEvidence(prev, prev.sessionId, processId);
}

function resetRuntimeEvidence(
  prev: McpScopeState,
  sessionId: string | null,
  processId: string | null,
): McpScopeState {
  return {
    ...prev,
    sessionId,
    processId,
    initProgress: null,
    initialized: false,
    catalogStale: false,
    rows: prev.rows.map((row) => ({
      ...row,
      phase: row.enabled ? "notConnected" : "disabled",
      reason: null,
      toolCount: null,
      source: "config",
      observedAt: undefined,
    })),
    pendingServers: {},
  };
}

/** Mark configured servers as initializing while the session connects them. */
export function applyMcpInitProgress(
  prev: McpScopeState,
  event: McpInitProgressEvent,
): McpScopeState {
  const sessionId = (event.sessionId || "").trim();
  if (!sessionId) return prev;
  const base = withSessionReset(prev, sessionId);
  return {
    ...base,
    initialized: false,
    initProgress: {
      connected: event.connected ?? null,
      total: event.total ?? null,
    },
    rows: base.rows.map((row) =>
      row.enabled && row.source === "config" && row.phase === "notConnected"
        ? { ...row, phase: "initializing" }
        : row,
    ),
  };
}

/**
 * Finish initialization.
 *
 * Servers still showing `initializing` never reported a terminal status, so they
 * become `unknown` rather than silently appearing available.
 */
export function applyMcpInitialized(
  prev: McpScopeState,
  event: { sessionId?: string | null },
): McpScopeState {
  const sessionId = (event.sessionId || "").trim();
  if (!sessionId) return prev;
  const base = withSessionReset(prev, sessionId);
  return {
    ...base,
    initialized: true,
    initProgress: null,
    rows: base.rows.map((row) =>
      row.phase === "initializing" ? { ...row, phase: "unknown" } : row,
    ),
  };
}

/**
 * Apply one per-server status delta.
 *
 * Unknown server names are ignored: a status without a matching catalog row
 * cannot be attributed, and inventing a row would misreport configuration.
 */
export function applyMcpServerStatus(
  prev: McpScopeState,
  event: McpServerStatusEvent,
  opts?: { now?: number },
): McpScopeState {
  const sessionId = (event.sessionId || "").trim();
  const server = (event.server || "").trim();
  if (!sessionId || !server) return prev;
  const base = withSessionReset(prev, sessionId);
  const index = base.rows.findIndex((row) => row.name === server);
  const now = opts?.now ?? Date.now();
  if (index < 0) {
    // The startup event may precede the catalog. Preserve evidence, but never
    // render an unconfigured row; the next catalog response will project it.
    return {
      ...base,
      catalogStale: true,
      pendingServers: {
        ...base.pendingServers,
        [server]: {
          status: event.status,
          reason: event.reason ?? null,
          toolCount: event.toolCount ?? null,
          observedAt: now,
        },
      },
    };
  }

  const rows = base.rows.slice();
  const current = rows[index]!;
  rows[index] = {
    ...current,
    phase: current.enabled ? toRuntimePhase(event.status) : "disabled",
    reason: event.reason ?? null,
    toolCount: event.toolCount ?? current.toolCount ?? null,
    source: "session",
    observedAt: now,
  };
  return { ...base, rows };
}

/** Record that the catalog snapshot no longer matches the session topology. */
export function applyMcpCatalogStale(
  prev: McpScopeState,
  event: McpCatalogStaleEvent,
): McpScopeState {
  const sessionId = (event.sessionId || "").trim();
  if (!sessionId) return prev;
  const base = withSessionReset(prev, sessionId);
  return base.catalogStale ? base : { ...base, catalogStale: true };
}

/**
 * Whether the panel should fetch the catalog now.
 *
 * Only a visible panel refreshes, and only when it has no snapshot or the
 * session reported a topology change. This avoids a refresh storm from
 * high-frequency tool/status pushes.
 */
export function shouldRefreshMcpCatalog(
  state: McpScopeState,
  opts: { visible: boolean; fetching: boolean },
): boolean {
  if (!opts.visible || opts.fetching) return false;
  if (state.catalogLoadedAt == null) return true;
  return state.catalogStale;
}

/** Count rows per phase for filter chips. */
export function countMcpPhases(
  state: McpScopeState,
): Record<McpRuntimePhase, number> {
  const counts = {
    disabled: 0,
    notConnected: 0,
    initializing: 0,
    ready: 0,
    needsAuth: 0,
    unavailable: 0,
    unknown: 0,
  } as Record<McpRuntimePhase, number>;
  for (const row of state.rows) counts[row.phase] += 1;
  return counts;
}
