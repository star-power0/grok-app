/**
 * Settings → general → compatibility tab.
 * Allows users to enable/disable loading resources from other IDEs (Claude, Cursor, Codex).
 */
import { useSettingsModel } from "@/providers/SettingsModelContext";
import type { SettingsViewModel } from "./types";
import { UiCheck } from "./shared";
import { createT, resolveLocale } from "@/i18n";

export function CompatibilitySection() {
  const s = useSettingsModel() as SettingsViewModel & Record<string, any>;
  const {
    locale,
    compatClaudeSkills = true,
    compatClaudeMcps = true,
    compatClaudeAgents = true,
    compatClaudeRules = true,
    compatClaudeHooks = true,
    compatClaudeSessions = true,
    compatCursorSkills = true,
    compatCursorMcps = true,
    compatCursorAgents = true,
    compatCursorRules = true,
    compatCursorHooks = true,
    compatCursorSessions = true,
    compatCodexSkills = false,
    compatCodexMcps = false,
    compatCodexAgents = false,
    compatCodexRules = false,
    compatCodexHooks = false,
    compatCodexSessions = true,
    onCompatClaudeSkills,
    onCompatClaudeMcps,
    onCompatClaudeAgents,
    onCompatClaudeRules,
    onCompatClaudeHooks,
    onCompatClaudeSessions,
    onCompatCursorSkills,
    onCompatCursorMcps,
    onCompatCursorAgents,
    onCompatCursorRules,
    onCompatCursorHooks,
    onCompatCursorSessions,
    onCompatCodexSkills,
    onCompatCodexMcps,
    onCompatCodexAgents,
    onCompatCodexRules,
    onCompatCodexHooks,
    onCompatCodexSessions,
  } = s;

  const t = createT(resolveLocale(locale));

  const rowHighlight = (_anchorId: string) => "";

  return (
    <>
      <h2 className="settings-page__h2">{t("settings.section.compatibility")}</h2>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">
              {t("settings.compatibility.desc")}
            </div>
          </div>
        </div>
      </div>

      {/* Claude Code */}
      <h3 className="settings-page__h3">Claude Code</h3>
      <div className="settings-card">
        <div className={"settings-row" + rowHighlight("settings-anchor-compatClaudeSkills")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.skills")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.skills.desc")}</div>
          </div>
          <UiCheck
            checked={compatClaudeSkills}
            onChange={() => onCompatClaudeSkills?.(!compatClaudeSkills)}
            ariaLabel={t("settings.compatibility.skills")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatClaudeMcps")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.mcps")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.mcps.desc")}</div>
          </div>
          <UiCheck
            checked={compatClaudeMcps}
            onChange={() => onCompatClaudeMcps?.(!compatClaudeMcps)}
            ariaLabel={t("settings.compatibility.mcps")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatClaudeAgents")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.agents")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.agents.desc")}</div>
          </div>
          <UiCheck
            checked={compatClaudeAgents}
            onChange={() => onCompatClaudeAgents?.(!compatClaudeAgents)}
            ariaLabel={t("settings.compatibility.agents")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatClaudeRules")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.rules")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.rules.desc")}</div>
          </div>
          <UiCheck
            checked={compatClaudeRules}
            onChange={() => onCompatClaudeRules?.(!compatClaudeRules)}
            ariaLabel={t("settings.compatibility.rules")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatClaudeHooks")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.hooks")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.hooks.desc")}</div>
          </div>
          <UiCheck
            checked={compatClaudeHooks}
            onChange={() => onCompatClaudeHooks?.(!compatClaudeHooks)}
            ariaLabel={t("settings.compatibility.hooks")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatClaudeSessions")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.sessions")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.sessions.desc")}</div>
          </div>
          <UiCheck
            checked={compatClaudeSessions}
            onChange={() => onCompatClaudeSessions?.(!compatClaudeSessions)}
            ariaLabel={t("settings.compatibility.sessions")}
          />
        </div>
      </div>

      {/* Cursor */}
      <h3 className="settings-page__h3">Cursor</h3>
      <div className="settings-card">
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCursorSkills")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.skills")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.skills.desc")}</div>
          </div>
          <UiCheck
            checked={compatCursorSkills}
            onChange={() => onCompatCursorSkills?.(!compatCursorSkills)}
            ariaLabel={t("settings.compatibility.skills")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCursorMcps")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.mcps")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.mcps.desc")}</div>
          </div>
          <UiCheck
            checked={compatCursorMcps}
            onChange={() => onCompatCursorMcps?.(!compatCursorMcps)}
            ariaLabel={t("settings.compatibility.mcps")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCursorAgents")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.agents")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.agents.desc")}</div>
          </div>
          <UiCheck
            checked={compatCursorAgents}
            onChange={() => onCompatCursorAgents?.(!compatCursorAgents)}
            ariaLabel={t("settings.compatibility.agents")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCursorRules")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.rules")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.rules.desc")}</div>
          </div>
          <UiCheck
            checked={compatCursorRules}
            onChange={() => onCompatCursorRules?.(!compatCursorRules)}
            ariaLabel={t("settings.compatibility.rules")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCursorHooks")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.hooks")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.hooks.desc")}</div>
          </div>
          <UiCheck
            checked={compatCursorHooks}
            onChange={() => onCompatCursorHooks?.(!compatCursorHooks)}
            ariaLabel={t("settings.compatibility.hooks")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCursorSessions")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.sessions")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.sessions.desc")}</div>
          </div>
          <UiCheck
            checked={compatCursorSessions}
            onChange={() => onCompatCursorSessions?.(!compatCursorSessions)}
            ariaLabel={t("settings.compatibility.sessions")}
          />
        </div>
      </div>

      {/* Codex */}
      <h3 className="settings-page__h3">Codex</h3>
      <div className="settings-card">
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCodexSkills")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.skills")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.skills.desc")}</div>
          </div>
          <UiCheck
            checked={compatCodexSkills}
            onChange={() => onCompatCodexSkills?.(!compatCodexSkills)}
            ariaLabel={t("settings.compatibility.skills")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCodexMcps")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.mcps")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.mcps.desc")}</div>
          </div>
          <UiCheck
            checked={compatCodexMcps}
            onChange={() => onCompatCodexMcps?.(!compatCodexMcps)}
            ariaLabel={t("settings.compatibility.mcps")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCodexAgents")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.agents")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.agents.desc")}</div>
          </div>
          <UiCheck
            checked={compatCodexAgents}
            onChange={() => onCompatCodexAgents?.(!compatCodexAgents)}
            ariaLabel={t("settings.compatibility.agents")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCodexRules")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.rules")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.rules.desc")}</div>
          </div>
          <UiCheck
            checked={compatCodexRules}
            onChange={() => onCompatCodexRules?.(!compatCodexRules)}
            ariaLabel={t("settings.compatibility.rules")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCodexHooks")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.hooks")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.hooks.desc")}</div>
          </div>
          <UiCheck
            checked={compatCodexHooks}
            onChange={() => onCompatCodexHooks?.(!compatCodexHooks)}
            ariaLabel={t("settings.compatibility.hooks")}
          />
        </div>
        <div className={"settings-row" + rowHighlight("settings-anchor-compatCodexSessions")}>
          <div className="settings-row__text">
            <div className="settings-row__label">{t("settings.compatibility.sessions")}</div>
            <div className="settings-row__desc">{t("settings.compatibility.sessions.desc")}</div>
          </div>
          <UiCheck
            checked={compatCodexSessions}
            onChange={() => onCompatCodexSessions?.(!compatCodexSessions)}
            ariaLabel={t("settings.compatibility.sessions")}
          />
        </div>
      </div>
    </>
  );
}
