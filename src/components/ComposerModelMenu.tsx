/**
 * Composer chip menus (Codex-style):
 * - Model (+effort)
 * - Access: session mode + permission in one panel
 * Narrow composer widths compress triggers to icon (+ short label).
 */

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  GROK_BUILD_MODELS,
  PERMISSION_POLICIES,
  SESSION_MODES,
  effortDisplayLabel,
  effortUiOptionsForCatalog,
  effortsForModel,
  findModel,
  spawnIdToEffortUiSlot,
  type ModelOption,
  type PermissionPolicyId,
} from "@/lib/grokCatalog";
import {
  buildComposerModelGroups,
  filterComposerModelGroups,
  isComposerModelEntryActive,
  type ComposerModelPick,
  type ComposerProviderInput,
} from "@/lib/composerModelGroups";
import { composerModelChipLabel } from "@/lib/effectiveModel";
import {
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconHandStop,
  IconList,
  IconRobot,
  IconShield,
  IconShieldCheck,
} from "@/components/icons";
import {
  FLOATING_MENU_Z_INDEX,
  useFloatingMenu,
  type FloatingPos,
} from "@/lib/floatingMenu";
import {
  acquireNativeWebviewCover,
  rectOverlapsNativeWebviewHost,
} from "@/lib/nativeWebviewCover";

type Nested = "model" | "effort" | null;

type ModelMenuSnapshot = {
  modelId: string;
  effort: string;
  models: ModelOption[];
  providers: ComposerProviderInput[];
  activeSource: string;
  activeProviderId: string | null;
  channelEfforts: ComposerModelMenuProps["channelEfforts"];
  applyNotes?: ComposerModelMenuProps["applyNotes"];
  labels: ComposerModelMenuProps["labels"];
};

/**
 * Deep-copy every input that affects panel geometry at open time.
 *
 * Exported for regression tests: the model picker's visible shake came from
 * account, provider, catalog and locale responses resolving independently while
 * the panel was open, each one re-measuring and re-anchoring it.
 */
export function snapshotModelMenuData(
  props: Pick<
    ComposerModelMenuProps,
    | "modelId"
    | "effort"
    | "models"
    | "providers"
    | "activeSource"
    | "activeProviderId"
    | "channelEfforts"
    | "applyNotes"
    | "labels"
  >,
): ModelMenuSnapshot {
  return {
    modelId: props.modelId,
    effort: props.effort,
    models: (props.models ?? GROK_BUILD_MODELS).map((model) => ({
      ...model,
      reasoningEfforts: model.reasoningEfforts?.map((item) => ({ ...item })),
    })),
    providers: (props.providers ?? []).map((provider) => ({
      ...provider,
      models: provider.models?.map((model) => ({ ...model })),
    })),
    activeSource: props.activeSource ?? "official",
    activeProviderId: props.activeProviderId ?? null,
    channelEfforts: props.channelEfforts?.map((item) => ({ ...item })) ?? null,
    applyNotes: props.applyNotes
      ? { ...props.applyNotes }
      : undefined,
    labels: { ...props.labels },
  };
}

function usePortalMenu(
  estHeight = 220,
  minWidth = 200,
  nestedKey?: string,
  fitContent = true,
  width?: number,
) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();

  const { pos, style: popStyle } = useFloatingMenu({
    open,
    triggerRef,
    panelRef: popRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: "auto",
    fitContent,
    width,
    minWidth,
    estHeight,
    gap: 8,
    deps: [nestedKey],
  });

  return {
    open,
    setOpen,
    pos,
    popStyle: popStyle as CSSProperties | undefined,
    rootRef,
    triggerRef,
    popRef,
    popId,
  };
}

function MenuShell({
  open,
  setOpen,
  rootRef,
  triggerRef,
  popRef,
  popId,
  pos,
  popStyle,
  triggerIcon,
  triggerText,
  triggerShort,
  ariaLabel,
  title,
  danger,
  children,
  onOpenChange,
  className = "",
}: {
  open: boolean;
  setOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  popRef: React.RefObject<HTMLDivElement | null>;
  popId: string;
  pos: FloatingPos | null;
  popStyle: CSSProperties | undefined;
  triggerIcon?: ReactNode;
  /** Full label (wide layout) */
  triggerText: string;
  /** Short label (medium; icon-only when very narrow via CSS) */
  triggerShort?: string;
  ariaLabel: string;
  title?: string;
  danger?: boolean;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const panel =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popRef}
            className={`cmm__pop cmm__pop--portal${className.includes("cmm--model") ? " cmm__pop--model" : ""}`}
            id={popId}
            role="dialog"
            aria-label={ariaLabel}
            style={popStyle}
          >
            {children}
          </div>,
          document.body,
        )
      : null;

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="cmm__trigger"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={popId}
      aria-label={ariaLabel}
      title={title}
      onClick={() => {
        const next = !open;
        onOpenChange?.(next);
        setOpen(next);
      }}
    >
      {triggerIcon ? (
        <span className="cmm__icon" aria-hidden>
          {triggerIcon}
        </span>
      ) : null}
      <span className="cmm__trigger-text cmm__trigger-text--full">
        {triggerText}
      </span>
      {triggerShort != null && (
        <span className="cmm__trigger-text cmm__trigger-text--short">
          {triggerShort}
        </span>
      )}
      <span className="cmm__chev" aria-hidden>
        <IconChevronDown size={12} />
      </span>
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={`cmm ${open ? "is-open" : ""} ${danger ? "cmm--danger" : ""} ${className}`.trim()}
    >
      {trigger}
      {panel}
    </div>
  );
}

/* ---------- Model + effort ---------- */

export interface ComposerModelMenuProps {
  modelId: string;
  effort: string;
  /** Live selectable models only (from Host catalog). */
  models?: ModelOption[];
  /** Configured custom providers for grouped menu entries. */
  providers?: ComposerProviderInput[];
  /** Active inference route: official | custom. */
  activeSource?: string;
  activeProviderId?: string | null;
  labels: {
    model: string;
    effort: string;
    effortHigh: string;
    effortMedium: string;
    effortLow: string;
    effortXhigh?: string;
    effortMax?: string;
    /** Search field placeholder in the model nested list. */
    modelSearchPlaceholder: string;
    /** Empty state when filter matches nothing. */
    modelSearchEmpty: string;
    /** Section header for official catalog models. */
    modelGroupOfficial: string;
    /** @deprecated Prefer real custom groups via `providers`. */
    modelViaProvider?: string;
  };
  /**
   * When custom route is active, use channel-configured efforts
   * (e.g. DeepSeek low/high/xhigh/max) instead of official catalog.
   */
  channelEfforts?: import("@/lib/grokCatalog").EffortOption[] | null;
  /** Prefer over onModel when provided. */
  onModelPick?: (pick: ComposerModelPick) => void;
  onModel?: (id: string) => void;
  onEffort: (id: string) => void;
  /**
   * Apply-path honesty when a live agent is attached (e.g. soft-respawn /
   * immediate set_model). Shown as a footer note in nested lists when set.
   */
  applyNotes?: {
    model?: string | null;
    effort?: string | null;
  };
}

function effortI18n(labels: ComposerModelMenuProps["labels"]) {
  return {
    high: labels.effortHigh,
    medium: labels.effortMedium,
    low: labels.effortLow,
    xhigh: labels.effortXhigh,
    max: labels.effortMax ?? labels.effortXhigh,
  };
}

/** Label for a spawn effort id via the canonical UI ladder (低/中/高/极高). */
function resolveEffortLabel(
  spawnId: string,
  catalogEfforts: ReturnType<typeof effortsForModel> | null | undefined,
  labels: ComposerModelMenuProps["labels"],
): string {
  const slot = spawnIdToEffortUiSlot(spawnId, catalogEfforts);
  return effortDisplayLabel(slot ?? spawnId, effortI18n(labels));
}

function ComposerModelMenuImpl({
  modelId,
  effort,
  models = GROK_BUILD_MODELS,
  providers = [],
  activeSource = "official",
  activeProviderId = null,
  channelEfforts = null,
  labels,
  onModelPick,
  onModel,
  onEffort,
  applyNotes,
}: ComposerModelMenuProps) {
  const [nested, setNested] = useState<Nested>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [menuSnapshot, setMenuSnapshot] = useState<ModelMenuSnapshot | null>(
    null,
  );
  const modelSearchRef = useRef<HTMLInputElement>(null);
  /*
   * Freeze the model catalog while the portal is open. During cold start the
   * official catalog, provider route and composer prefs resolve independently;
   * allowing each response to resize/re-anchor this panel is what makes the
   * picker appear to shake. A fixed-width panel plus a snapshot keeps the
   * anchor and list stable until the user closes it.
   */
  const menu = usePortalMenu(240, 300, nested ?? "root", false, 360);
  const menuData = menuSnapshot ?? {
    modelId,
    effort,
    models,
    providers,
    activeSource,
    activeProviderId,
    channelEfforts,
    applyNotes,
    labels,
  };
  const menuLabels = menuData.labels;
  const modelList =
    menuData.models.length > 0 ? menuData.models : GROK_BUILD_MODELS;
  const groups = buildComposerModelGroups({
    officialModels: modelList,
    providers: menuData.providers,
    officialGroupTitle: menuLabels.modelGroupOfficial,
  });
  const filteredGroups = filterComposerModelGroups(groups, modelQuery);
  const activeModel = findModel(menuData.modelId, modelList);
  const effortCatalog =
    menuData.activeSource === "custom" &&
    menuData.channelEfforts &&
    menuData.channelEfforts.length > 0
      ? effortsForModel(null, menuData.channelEfforts)
      : effortsForModel(activeModel);
  /** Ordered UI ladder (3 or 4 slots); spawnId is the real model value. */
  const effortUiList = effortUiOptionsForCatalog(effortCatalog);

  const clearModelQuery = () => setModelQuery("");

  const selectPick = (pick: ComposerModelPick) => {
    if (onModelPick) {
      onModelPick(pick);
    } else if (pick.kind === "official" && onModel) {
      onModel(pick.modelId);
    }
    setNested(null);
    // Selection ends this snapshot so the next open reads the latest route/catalog.
    menu.setOpen(false);
  };

  useEffect(() => {
    if (!menu.open) {
      setNested(null);
      clearModelQuery();
      setMenuSnapshot(null);
    }
  }, [menu.open]);

  // Clear filter when leaving the model nested list (back / effort / select).
  useEffect(() => {
    if (nested !== "model") clearModelQuery();
  }, [nested]);

  // Autofocus search when entering the model list.
  useEffect(() => {
    if (!menu.open || nested !== "model") return;
    const id = requestAnimationFrame(() => {
      modelSearchRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [menu.open, nested]);

  useEffect(() => {
    if (!menu.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && nested) {
        // Capture + stopImmediate so floatingMenu does not close the whole panel.
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setNested(null);
        return;
      }
      // Typing while on model list focuses the filter (e.g. after tabbing to a row).
      if (nested !== "model") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const active = document.activeElement;
      if (
        active === modelSearchRef.current ||
        (active instanceof HTMLElement &&
          active.closest("input, textarea, [contenteditable=true]"))
      ) {
        return;
      }
      e.preventDefault();
      setModelQuery((q) => q + e.key);
      modelSearchRef.current?.focus();
    };
    // Capture so Escape wins over useFloatingMenu's bubble listener.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [menu.open, nested]);

  const activeCustom =
    menuData.activeSource === "custom" && menuData.activeProviderId
      ? (() => {
          const p = menuData.providers.find(
            (x) => x.id === menuData.activeProviderId,
          );
          if (!p) return null;
          const activeId = p.model?.trim() ?? "";
          const entry =
            p.models?.find((m) => m.id === activeId) ??
            (activeId ? { id: activeId, name: activeId } : null);
          return entry
            ? { name: entry.name || entry.id, model: entry.id }
            : { name: p.name, model: p.model };
        })()
      : null;
  const activeRequestModel =
    menuData.activeSource === "custom"
      ? menuData.providers.find(
          (x) => x.id === menuData.activeProviderId,
        )?.model ?? null
      : null;
  const officialLabel = activeModel?.label ?? menuData.modelId;
  const modelLabel = composerModelChipLabel({
    modelId: menuData.modelId,
    officialLabel,
    activeCustom,
  });
  const eLabel = resolveEffortLabel(
    menuData.effort,
    effortCatalog,
    menuLabels,
  );
  // Compact trigger: model + short effort (locale), no middle-dot noise.
  const triggerText = `${modelLabel} ${eLabel}`;
  const title = `${menuLabels.model}: ${modelLabel} · ${menuLabels.effort}: ${eLabel}`;

  return (
    <MenuShell
      {...menu}
      className="cmm--model"
      triggerIcon={<IconBolt size={14} />}
      triggerText={triggerText}
      triggerShort={eLabel}
      ariaLabel={menuLabels.model}
      title={title}
      onOpenChange={(o) => {
        if (o) {
          setMenuSnapshot(
            snapshotModelMenuData({
              modelId,
              effort,
              models,
              providers,
              activeSource,
              activeProviderId,
              channelEfforts,
              applyNotes,
              labels,
            }),
          );
          return;
        }
        setNested(null);
        clearModelQuery();
        setMenuSnapshot(null);
      }}
    >
      {nested === null ? (
        <>
          <button
            type="button"
            className="cmm__row"
            onClick={() => setNested("model")}
          >
            <span>{menuLabels.model}</span>
            <span className="cmm__row-val">
              <span className="cmm__row-val-text" title={modelLabel}>
                {modelLabel}
              </span>
              <IconChevronRight size={14} />
            </span>
          </button>
          <button
            type="button"
            className="cmm__row"
            onClick={() => setNested("effort")}
          >
            <span>{menuLabels.effort}</span>
            <span className="cmm__row-val">
              <span className="cmm__row-val-text">{eLabel}</span>
              <IconChevronRight size={14} />
            </span>
          </button>
        </>
      ) : (
        <div className="cmm__nested">
          <button
            type="button"
            className="cmm__back"
            onClick={() => setNested(null)}
          >
            {nested === "model" ? menuLabels.model : menuLabels.effort}
          </button>
          {nested === "model" &&
            (groups.length === 0 ? (
              <div className="cmm__opt cmm__opt--muted" role="status">
                <span className="cmm__opt-main">
                  <span className="cmm__opt-title">{menuData.modelId || "—"}</span>
                </span>
              </div>
            ) : (
              <>
                <div className="cmm__search">
                  <input
                    ref={modelSearchRef}
                    type="search"
                    className="cmm__search-input"
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    placeholder={menuLabels.modelSearchPlaceholder}
                    aria-label={menuLabels.modelSearchPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    // Keep menu open / avoid accidental form submit.
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                    }}
                  />
                </div>
                {filteredGroups.length === 0 ? (
                  <div className="cmm__opt cmm__opt--muted" role="status">
                    <span className="cmm__opt-main">
                      <span className="cmm__opt-title">
                        {menuLabels.modelSearchEmpty}
                      </span>
                    </span>
                  </div>
                ) : (
                  filteredGroups.map((group) => (
                    <div key={group.key}>
                      <div className="cmm__section">{group.title}</div>
                      {group.entries.map((entry) => {
                        const active = isComposerModelEntryActive(entry, {
                          activeSource: menuData.activeSource,
                          activeProviderId: menuData.activeProviderId,
                          activeRequestModel,
                          modelId: menuData.modelId,
                        });
                        return (
                          <button
                            key={entry.key}
                            type="button"
                            className={"cmm__opt" + (active ? " is-active" : "")}
                            onClick={() => selectPick(entry.pick)}
                          >
                            <span className="cmm__opt-main">
                              <span className="cmm__opt-title">
                                {entry.title}
                              </span>
                              {entry.subtitle ? (
                                <span className="cmm__opt-desc">
                                  {entry.subtitle}
                                </span>
                              ) : null}
                            </span>
                            {active ? (
                              <span className="cmm__opt-check" aria-hidden>
                                <IconCheck size={16} />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </>
            ))}
          {nested === "effort" &&
            effortUiList.map((e) => {
              const active =
                e.spawnId === menuData.effort ||
                spawnIdToEffortUiSlot(menuData.effort, effortCatalog) === e.uiId;
              return (
                <button
                  key={e.uiId}
                  type="button"
                  className={"cmm__opt" + (active ? " is-active" : "")}
                  onClick={() => {
                    onEffort(e.spawnId);
                    setNested(null);
                  }}
                >
                  <span className="cmm__opt-main">
                    <span className="cmm__opt-title">
                      {effortDisplayLabel(e.uiId, effortI18n(menuLabels))}
                    </span>
                  </span>
                  {active ? (
                    <span className="cmm__opt-check" aria-hidden>
                      <IconCheck size={16} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          {nested === "model" && menuData.applyNotes?.model ? (
            <div className="cmm__apply-note" role="note">
              {menuData.applyNotes.model}
            </div>
          ) : null}
          {nested === "effort" && menuData.applyNotes?.effort ? (
            <div className="cmm__apply-note" role="note">
              {menuData.applyNotes.effort}
            </div>
          ) : null}
        </div>
      )}
    </MenuShell>
  );
}

/**
 * Memo boundary (pairs with the open-time snapshot inside the component):
 * the snapshot stops catalog updates from re-anchoring an open panel, and this
 * stops unrelated AppWorkbench renders from re-rendering the menu at all.
 */
export const ComposerModelMenu = memo(ComposerModelMenuImpl);

/* ---------- Access: mode + permission (Codex-style one entry) ---------- */

/**
 * Access panel height estimate used for the pre-mount flip/anchor decision.
 *
 * Derived from the rendered structure rather than guessed: one hint header,
 * two section labels, and nine rich two-line rows (3 modes + 6 policies).
 * `.cmm__pop` caps the panel at `min(480px, 100vh - 24px)`, so the estimate is
 * clamped to that ceiling — going higher would flip the menu on tall screens
 * even though the panel can never render that large.
 */
const ACCESS_SHEET_WIDTH = 420;
const ACCESS_SHEET_MAX_HEIGHT = 640;
const ACCESS_SHEET_MARGIN = 8;
const ACCESS_SHEET_GAP = 8;

type AccessSheetRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Resolve the access picker in one pass. Unlike small dropdowns, this sheet is
 * taller than the space above the composer on many desktop layouts. Its box is
 * therefore fixed before it is mounted instead of being measured and re-anchored
 * after the first paint.
 */
export function computeAccessSheetRect(
  trigger: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  viewportWidth: number,
  viewportHeight: number,
): AccessSheetRect {
  const usableWidth = Math.max(1, viewportWidth - ACCESS_SHEET_MARGIN * 2);
  const usableHeight = Math.max(1, viewportHeight - ACCESS_SHEET_MARGIN * 2);
  const width = Math.min(ACCESS_SHEET_WIDTH, usableWidth);
  const height = Math.min(ACCESS_SHEET_MAX_HEIGHT, usableHeight);
  const left = Math.max(
    ACCESS_SHEET_MARGIN,
    Math.min(trigger.right - width, viewportWidth - ACCESS_SHEET_MARGIN - width),
  );
  const aboveTop = trigger.top - ACCESS_SHEET_GAP - height;
  const top = aboveTop >= ACCESS_SHEET_MARGIN ? aboveTop : ACCESS_SHEET_MARGIN;

  return { left, top, width, height };
}

function viewportSize() {
  return {
    width: typeof window === "undefined" ? 1024 : window.innerWidth,
    height: typeof window === "undefined" ? 768 : window.innerHeight,
  };
}

/**
 * Fixed access sheet lifecycle. It deliberately does not observe the trigger,
 * composer ancestors, or panel content while open: the open sheet must remain
 * visually still even while surrounding chat state changes.
 */
function useAccessSheet() {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<AccessSheetRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetId = useId();

  const positionFromTrigger = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const viewport = viewportSize();
    setRect(computeAccessSheetRect(trigger.getBoundingClientRect(), viewport.width, viewport.height));
  }, []);

  const openSheet = useCallback(() => {
    positionFromTrigger();
    setOpen(true);
  }, [positionFromTrigger]);

  const closeSheet = useCallback(() => {
    setOpen(false);
    setRect(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    let frame: number | null = null;
    const onResize = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        positionFromTrigger();
      });
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || sheetRef.current?.contains(target)) return;
      closeSheet();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSheet();
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeSheet, open, positionFromTrigger]);

  return { closeSheet, open, openSheet, rect, rootRef, sheetId, sheetRef, triggerRef };
}

export interface ComposerAccessMenuProps {
  mode: string;
  policy: string;
  labels: {
    access: string;
    accessHint: string;
    mode: string;
    modeAgent: string;
    modePlan: string;
    modeAsk: string;
    modeAgentDesc: string;
    modePlanDesc: string;
    modeAskDesc: string;
    permission: string;
    policyAsk: string;
    policyAcceptEdits: string;
    policySession: string;
    policyAuto: string;
    policyDontAsk: string;
    policyYolo: string;
    policyAskDesc: string;
    policyAcceptEditsDesc: string;
    policySessionDesc: string;
    policyAutoDesc: string;
    policyDontAskDesc: string;
    policyYoloDesc: string;
    policyShortAsk: string;
    policyShortAccept: string;
    policyShortSession: string;
    policyShortAuto: string;
    policyShortDontAsk: string;
    policyShortYolo: string;
  };
  onMode: (id: string) => void;
  onPolicy: (id: PermissionPolicyId) => void;
}

function modeLabel(id: string, labels: ComposerAccessMenuProps["labels"]): string {
  if (id === "plan") return labels.modePlan;
  if (id === "ask") return labels.modeAsk;
  return labels.modeAgent;
}

function modeDesc(id: string, labels: ComposerAccessMenuProps["labels"]): string {
  if (id === "plan") return labels.modePlanDesc;
  if (id === "ask") return labels.modeAskDesc;
  return labels.modeAgentDesc;
}

function policyLabel(
  id: string,
  labels: ComposerAccessMenuProps["labels"],
): string {
  switch (id) {
    case "accept_edits":
      return labels.policyAcceptEdits;
    case "allow_for_session":
      return labels.policySession;
    case "auto":
      return labels.policyAuto;
    case "dont_ask":
      return labels.policyDontAsk;
    case "always_approve":
      return labels.policyYolo;
    default:
      return labels.policyAsk;
  }
}

function policyShort(
  id: string,
  labels: ComposerAccessMenuProps["labels"],
): string {
  switch (id) {
    case "accept_edits":
      return labels.policyShortAccept;
    case "allow_for_session":
      return labels.policyShortSession;
    case "auto":
      return labels.policyShortAuto;
    case "dont_ask":
      return labels.policyShortDontAsk;
    case "always_approve":
      return labels.policyShortYolo;
    default:
      return labels.policyShortAsk;
  }
}

function policyDesc(
  id: string,
  labels: ComposerAccessMenuProps["labels"],
): string {
  switch (id) {
    case "accept_edits":
      return labels.policyAcceptEditsDesc;
    case "allow_for_session":
      return labels.policySessionDesc;
    case "auto":
      return labels.policyAutoDesc;
    case "dont_ask":
      return labels.policyDontAskDesc;
    case "always_approve":
      return labels.policyYoloDesc;
    default:
      return labels.policyAskDesc;
  }
}

function policyIcon(id: string) {
  switch (id) {
    case "accept_edits":
      return <IconShieldCheck size={18} />;
    case "allow_for_session":
      return <IconShield size={18} />;
    case "auto":
      return <IconBolt size={18} />;
    case "dont_ask":
      return <IconHandStop size={18} />;
    case "always_approve":
      return <IconAlertTriangle size={18} />;
    default:
      return <IconHandStop size={18} />;
  }
}

function modeIcon(id: string) {
  if (id === "plan") return <IconList size={18} />;
  if (id === "ask") return <IconHandStop size={18} />;
  return <IconRobot size={18} />;
}

function ComposerAccessMenuImpl({
  mode,
  policy,
  labels,
  onMode,
  onPolicy,
}: ComposerAccessMenuProps) {
  const sheet = useAccessSheet();
  const isDanger = policy === "always_approve";
  const full = policyLabel(policy, labels);
  const short = policyShort(policy, labels);
  const title = `${labels.mode}: ${modeLabel(mode, labels)} · ${labels.permission}: ${full}`;

  useEffect(() => {
    if (!sheet.open || !sheet.rect) return;
    const rect = sheet.rect;
    if (
      !rectOverlapsNativeWebviewHost({
        left: rect.left,
        top: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        width: rect.width,
        height: rect.height,
      })
    ) {
      return;
    }
    return acquireNativeWebviewCover();
  }, [sheet.open, sheet.rect]);

  const panel =
    sheet.open && sheet.rect && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={sheet.sheetRef}
            className="cmm__pop cmm__pop--portal cmm__pop--access-sheet"
            id={sheet.sheetId}
            role="dialog"
            aria-label={labels.access}
            style={{
              height: sheet.rect.height,
              left: sheet.rect.left,
              top: sheet.rect.top,
              width: sheet.rect.width,
              zIndex: FLOATING_MENU_Z_INDEX,
            }}
          >
            <div className="cmm__header">
              <div className="cmm__header-title">{labels.accessHint}</div>
            </div>

            <div className="cmm__section">{labels.mode}</div>
            {SESSION_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={"cmm__opt cmm__opt--rich" + (m.id === mode ? " is-active" : "")}
                onClick={() => onMode(m.id)}
              >
                <span className="cmm__opt-icon" aria-hidden>
                  {modeIcon(m.id)}
                </span>
                <span className="cmm__opt-main">
                  <span className="cmm__opt-title">{modeLabel(m.id, labels)}</span>
                  <span className="cmm__opt-desc">{modeDesc(m.id, labels)}</span>
                </span>
                {m.id === mode && (
                  <span className="cmm__opt-check" aria-hidden>
                    <IconCheck size={16} />
                  </span>
                )}
              </button>
            ))}

            <div className="cmm__section cmm__section--gap">{labels.permission}</div>
            {PERMISSION_POLICIES.map((p) => (
              <button
                key={p.id}
                type="button"
                className={
                  "cmm__opt cmm__opt--rich" +
                  (p.id === policy ? " is-active" : "") +
                  (p.dangerous ? " is-danger" : "")
                }
                onClick={() => {
                  onPolicy(p.id);
                  sheet.closeSheet();
                }}
              >
                <span className="cmm__opt-icon" aria-hidden>
                  {policyIcon(p.id)}
                </span>
                <span className="cmm__opt-main">
                  <span className="cmm__opt-title">{policyLabel(p.id, labels)}</span>
                  <span className="cmm__opt-desc">{policyDesc(p.id, labels)}</span>
                </span>
                {p.id === policy && (
                  <span className="cmm__opt-check" aria-hidden>
                    <IconCheck size={16} />
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={sheet.rootRef}
      className={`cmm ${sheet.open ? "is-open" : ""} ${isDanger ? "cmm--danger" : ""} cmm--access`.trim()}
    >
      <button
        ref={sheet.triggerRef}
        type="button"
        className="cmm__trigger"
        aria-haspopup="dialog"
        aria-expanded={sheet.open}
        aria-controls={sheet.sheetId}
        aria-label={labels.access}
        title={title}
        onClick={() => {
          if (sheet.open) {
            sheet.closeSheet();
          } else {
            sheet.openSheet();
          }
        }}
      >
        <span className="cmm__icon" aria-hidden>
          {policyIcon(policy)}
        </span>
        <span className="cmm__trigger-text cmm__trigger-text--full">{full}</span>
        <span className="cmm__trigger-text cmm__trigger-text--short">{short}</span>
        <span className="cmm__chev" aria-hidden>
          <IconChevronDown size={12} />
        </span>
      </button>
      {panel}
    </div>
  );
}

/**
 * Memo boundary: the composer sits inside AppWorkbench, so unrelated state
 * (streaming, toasts, timers) re-rendered this panel and re-measured it while
 * open. Callers pass a memoized `labels` bag and stable handlers, so the panel
 * now only re-renders when mode/policy/locale actually change.
 */
export const ComposerAccessMenu = memo(ComposerAccessMenuImpl);

