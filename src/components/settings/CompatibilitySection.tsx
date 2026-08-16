/**
 * Settings → general → compatibility tab.
 * Controls which third-party IDE resources Grok Build may consume.
 */
import { createT, resolveLocale } from "@/i18n";
import { useSettingsModel } from "@/providers/SettingsModelContext";
import { UiCheck } from "./shared";
import type { SettingsViewModel } from "./types";

type CompatibilityToggleProps = {
  label: string;
  description: string;
  checked: boolean;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
};

function CompatibilityToggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: CompatibilityToggleProps) {
  return (
    <div className={`settings-row${disabled ? " is-disabled" : ""}`}>
      <div className="settings-row__text">
        <div className="settings-row__label">{label}</div>
        <div className="settings-row__desc">{description}</div>
      </div>
      <UiCheck
        checked={checked}
        disabled={disabled}
        onChange={() => onChange?.(!checked)}
        ariaLabel={label}
      />
    </div>
  );
}

export function CompatibilitySection() {
  const s = useSettingsModel() as SettingsViewModel & Record<string, unknown>;
  const {
    locale,
    compatibilityEnabled = false,
    compatibilityIndeterminate = false,
    onCompatibilityEnabled,
    compatClaudeSkills = false,
    compatClaudeMcps = false,
    compatClaudeAgents = false,
    compatClaudeRules = false,
    compatClaudeHooks = false,
    compatClaudeSessions = false,
    compatCursorSkills = true,
    compatCursorMcps = true,
    compatCursorAgents = true,
    compatCursorRules = true,
    compatCursorHooks = true,
    compatCursorSessions = true,
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
    onCompatCodexSessions,
  } = s;
  const t = createT(resolveLocale(locale));
  const skills = t("settings.compatibility.skills");
  const mcps = t("settings.compatibility.mcps");
  const agents = t("settings.compatibility.agents");
  const rules = t("settings.compatibility.rules");
  const hooks = t("settings.compatibility.hooks");
  const sessions = t("settings.compatibility.sessions");
  const reserved = t("settings.compatibility.reserved.desc");

  return (
    <>
      <h2 className="settings-page__h2">{t("settings.section.compatibility")}</h2>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">
              {t("settings.compatibility.master")}
            </div>
            <div className="settings-row__desc">
              {t("settings.compatibility.master.desc")}
            </div>
          </div>
          <UiCheck
            checked={compatibilityEnabled}
            indeterminate={compatibilityIndeterminate}
            onChange={() => onCompatibilityEnabled?.(!compatibilityEnabled)}
            ariaLabel={t("settings.compatibility.master")}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__desc">{t("settings.compatibility.desc")}</div>
          </div>
        </div>
      </div>

      <h3 className="settings-page__h3">Claude Code</h3>
      <div className="settings-card">
        <CompatibilityToggle label={skills} description={t("settings.compatibility.skills.desc")} checked={compatClaudeSkills} onChange={onCompatClaudeSkills} />
        <CompatibilityToggle label={mcps} description={t("settings.compatibility.mcps.desc")} checked={compatClaudeMcps} onChange={onCompatClaudeMcps} />
        <CompatibilityToggle label={agents} description={t("settings.compatibility.agents.desc")} checked={compatClaudeAgents} onChange={onCompatClaudeAgents} />
        <CompatibilityToggle label={rules} description={t("settings.compatibility.rules.desc")} checked={compatClaudeRules} onChange={onCompatClaudeRules} />
        <CompatibilityToggle label={hooks} description={t("settings.compatibility.hooks.desc")} checked={compatClaudeHooks} onChange={onCompatClaudeHooks} />
        <CompatibilityToggle label={sessions} description={t("settings.compatibility.sessions.desc")} checked={compatClaudeSessions} onChange={onCompatClaudeSessions} />
      </div>

      <h3 className="settings-page__h3">Cursor</h3>
      <div className="settings-card">
        <CompatibilityToggle label={skills} description={t("settings.compatibility.skills.desc")} checked={compatCursorSkills} onChange={onCompatCursorSkills} />
        <CompatibilityToggle label={mcps} description={t("settings.compatibility.mcps.desc")} checked={compatCursorMcps} onChange={onCompatCursorMcps} />
        <CompatibilityToggle label={agents} description={t("settings.compatibility.agents.desc")} checked={compatCursorAgents} onChange={onCompatCursorAgents} />
        <CompatibilityToggle label={rules} description={t("settings.compatibility.rules.desc")} checked={compatCursorRules} onChange={onCompatCursorRules} />
        <CompatibilityToggle label={hooks} description={t("settings.compatibility.hooks.desc")} checked={compatCursorHooks} onChange={onCompatCursorHooks} />
        <CompatibilityToggle label={sessions} description={t("settings.compatibility.sessions.desc")} checked={compatCursorSessions} onChange={onCompatCursorSessions} />
      </div>

      <h3 className="settings-page__h3">Codex</h3>
      <div className="settings-card">
        <CompatibilityToggle label={skills} description={reserved} checked={false} disabled />
        <CompatibilityToggle label={mcps} description={reserved} checked={false} disabled />
        <CompatibilityToggle label={agents} description={reserved} checked={false} disabled />
        <CompatibilityToggle label={rules} description={reserved} checked={false} disabled />
        <CompatibilityToggle label={hooks} description={reserved} checked={false} disabled />
        <CompatibilityToggle label={sessions} description={t("settings.compatibility.sessions.desc")} checked={compatCodexSessions} onChange={onCompatCodexSessions} />
      </div>
    </>
  );
}
