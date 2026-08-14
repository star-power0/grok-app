//! Run identity and frozen per-run configuration.
//!
//! A "run" is one dispatched `session/prompt` attempt. It owns the model,
//! provider route and capability snapshot that were in force when it started.
//! Config changes made while a run is in flight apply to the *next* run — the
//! active run keeps its frozen copy so late events can be attributed to the
//! configuration that actually produced them.
//!
//! `runEpoch` increments on every dispatch for a session, including an explicit
//! restart of the same user turn. `turnId` is stable for one user prompt and
//! survives interjection splits, so `{turnId, runEpoch}` distinguishes "same
//! question, retried under a new model" from "a different question".
//!
//! Everything here is pure. `tauri::test::mock_app()` crashes the Windows test
//! binary (`STATUS_ENTRYPOINT_NOT_FOUND`, tauri #14580 / #13419), so run
//! transitions must be verifiable without an `AppHandle`.

use serde::{Deserialize, Serialize};

/// Config that a run captures at dispatch and never re-reads.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenRunConfig {
    /// Composer-selected model id (may be a provider section id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// Model id actually handed to the agent for this run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_model_id: Option<String>,
    /// Provider route id (`official` or a custom section id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_mode: Option<String>,
}

/// The in-flight run for a session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveRun {
    /// Stable across interjections and across a restart of the same prompt.
    pub turn_id: String,
    /// Bumped on every dispatch; identifies this attempt.
    pub run_epoch: u64,
    pub config: FrozenRunConfig,
}

/// Why the previous run was superseded (audit trail for restarts).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunSupersedeReason {
    /// User asked to apply a config change to the turn already running.
    ConfigRestart,
}

/// What a config change should do to the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelSwitchPlan {
    /// No run in flight — rebind the live agent now.
    ApplyNow,
    /// A run is in flight; the switch takes effect on the next turn.
    DeferToNextTurn,
    /// Caller explicitly asked to interrupt and re-dispatch the current turn.
    RestartCurrentRun,
}

/// Requested scope for a config change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelSwitchScope {
    /// Default: never disturb a running turn.
    NextTurn,
    /// Interrupt the active run and re-dispatch the same prompt.
    RestartCurrentTurn,
}

impl Default for ModelSwitchScope {
    fn default() -> Self {
        Self::NextTurn
    }
}

/// Outcome of a model/provider switch, for UI copy and telemetry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSwitchOutcome {
    pub plan: ModelSwitchPlan,
    /// Model the in-flight run keeps using (None when nothing is running).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub running_model_id: Option<String>,
    /// Model the next turn will use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_model_id: Option<String>,
    /// Turn that will be restarted (only for `RestartCurrentRun`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restarting_turn_id: Option<String>,
}

/// Decide what a config change does, given whether a run is in flight.
///
/// Busy is passed in rather than derived so the caller can define "busy" once
/// (`prompt_in_flight` plus FSM state) and this stays pure.
pub fn plan_model_switch(busy: bool, scope: ModelSwitchScope) -> ModelSwitchPlan {
    match (busy, scope) {
        (false, _) => ModelSwitchPlan::ApplyNow,
        (true, ModelSwitchScope::NextTurn) => ModelSwitchPlan::DeferToNextTurn,
        (true, ModelSwitchScope::RestartCurrentTurn) => ModelSwitchPlan::RestartCurrentRun,
    }
}

/// Whether an event tagged with `{turn_id, run_epoch}` still belongs to `active`.
///
/// Untagged events (both `None`) are accepted: the CLI does not echo run
/// identity, so most ACP traffic is attributed by process routing. Only events
/// the Host itself tagged can be rejected as stale, and rejecting them is what
/// keeps a superseded run from writing into the run that replaced it.
pub fn event_belongs_to_run(
    active: Option<&ActiveRun>,
    turn_id: Option<&str>,
    run_epoch: Option<u64>,
) -> bool {
    let (Some(turn_id), Some(run_epoch)) = (turn_id, run_epoch) else {
        return true;
    };
    match active {
        Some(run) => run.turn_id == turn_id && run.run_epoch == run_epoch,
        None => false,
    }
}

impl super::SessionManager {
    /// Open a run on `s`, freezing the config in force right now.
    ///
    /// `turn_id` is `None` for a new user prompt (a fresh id is minted) and
    /// `Some(existing)` when re-dispatching the same prompt after a switch.
    pub(super) fn open_run_locked(
        s: &mut super::LiveSession,
        turn_id: Option<String>,
        agent_model_id: Option<String>,
        provider_id: Option<String>,
    ) -> ActiveRun {
        s.run_epoch_seq = s.run_epoch_seq.saturating_add(1);
        let run = ActiveRun {
            turn_id: turn_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            run_epoch: s.run_epoch_seq,
            config: FrozenRunConfig {
                model_id: s.model_id.clone(),
                agent_model_id,
                provider_id,
                effort: s.effort.clone(),
                product_mode: s.product_mode.clone(),
            },
        };
        s.active_turn_id = Some(run.turn_id.clone());
        s.active_run = Some(run.clone());
        run
    }

    /// Close the active run. Keeps `run_epoch_seq` so a late event from the run
    /// that just ended can never look current again.
    pub(super) fn close_run_locked(s: &mut super::LiveSession) {
        s.active_turn_id = None;
        s.active_run = None;
        s.active_run_prompt = None;
    }

    /// True when a config change must not touch the in-flight run.
    pub(super) fn run_is_busy_locked(s: &super::LiveSession) -> bool {
        s.prompt_in_flight
            || matches!(
                s.fsm.state(),
                super::SessionState::Streaming | super::SessionState::AwaitingPermission
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(turn: &str, epoch: u64) -> ActiveRun {
        ActiveRun {
            turn_id: turn.into(),
            run_epoch: epoch,
            config: FrozenRunConfig {
                model_id: Some("model-a".into()),
                agent_model_id: Some("model-a".into()),
                provider_id: Some("site-a".into()),
                effort: None,
                product_mode: None,
            },
        }
    }

    #[test]
    fn idle_session_applies_switch_immediately() {
        assert_eq!(
            plan_model_switch(false, ModelSwitchScope::NextTurn),
            ModelSwitchPlan::ApplyNow
        );
        assert_eq!(
            plan_model_switch(false, ModelSwitchScope::RestartCurrentTurn),
            ModelSwitchPlan::ApplyNow
        );
    }

    #[test]
    fn busy_session_defers_unless_restart_requested() {
        assert_eq!(
            plan_model_switch(true, ModelSwitchScope::NextTurn),
            ModelSwitchPlan::DeferToNextTurn
        );
        assert_eq!(
            plan_model_switch(true, ModelSwitchScope::RestartCurrentTurn),
            ModelSwitchPlan::RestartCurrentRun
        );
    }

    #[test]
    fn untagged_events_are_always_accepted() {
        let active = run("turn-1", 2);
        assert!(event_belongs_to_run(Some(&active), None, None));
        assert!(event_belongs_to_run(None, None, None));
        // A half-tagged event carries no usable identity either.
        assert!(event_belongs_to_run(Some(&active), Some("turn-9"), None));
    }

    #[test]
    fn tagged_events_from_a_superseded_epoch_are_rejected() {
        let active = run("turn-1", 2);
        assert!(event_belongs_to_run(Some(&active), Some("turn-1"), Some(2)));
        assert!(!event_belongs_to_run(
            Some(&active),
            Some("turn-1"),
            Some(1)
        ));
        assert!(!event_belongs_to_run(
            Some(&active),
            Some("turn-2"),
            Some(2)
        ));
        // Turn already closed: a tagged straggler must not reopen it.
        assert!(!event_belongs_to_run(None, Some("turn-1"), Some(2)));
    }

    #[test]
    fn a_restart_keeps_the_turn_id_and_only_advances_the_epoch() {
        // What distinguishes "same question retried under a new model" from a
        // brand new question: the turn id is stable, the epoch is not.
        let first = run("turn-1", 4);
        let restarted = ActiveRun {
            run_epoch: 5,
            ..first.clone()
        };
        assert_eq!(restarted.turn_id, first.turn_id);
        assert!(!event_belongs_to_run(
            Some(&restarted),
            Some(&first.turn_id),
            Some(first.run_epoch)
        ));
        assert!(event_belongs_to_run(
            Some(&restarted),
            Some(&restarted.turn_id),
            Some(restarted.run_epoch)
        ));
    }
}
