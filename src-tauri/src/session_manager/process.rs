//! Process capacity, park/unpark, idle recycle, snapshots.

#![allow(dead_code)] // residual-clippy: snapshot_from_parked
use std::collections::{HashMap, HashSet};
use std::time::Instant;

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::acp_client::AcpClient;
use crate::error::{AgentError, AgentErrorCode};
use crate::journal_throttle::JournalWriteThrottle;
use crate::permission::SessionAllowCache;
use crate::process_limits::{
    can_spawn_process, is_idle_expired, normalize_idle_minutes, normalize_max_concurrent,
    parked_slots_to_free_for_spawn, process_limit_message,
};
use crate::session_fsm::{SessionFsm, SessionState};
use crate::store::{self, ChatMessageStored};

use super::*;

impl SessionManager {
    pub(super) fn active_process_count(&self) -> u32 {
        let live = self
            .inner
            .lock()
            .as_ref()
            .and_then(|s| s.acp.as_ref())
            .filter(|c| c.is_alive())
            .is_some() as u32;
        let background = self
            .background
            .lock()
            .values()
            .filter(|s| s.acp.as_ref().is_some_and(|c| c.is_alive()))
            .count() as u32;
        let parked = self
            .parked
            .lock()
            .values()
            .filter(|p| p.acp.is_alive())
            .count() as u32;
        live + background + parked
    }

    pub(super) fn max_concurrent_from_settings() -> u32 {
        normalize_max_concurrent(store::load_settings().max_concurrent_agents)
    }

    pub(super) fn idle_minutes_from_settings() -> u32 {
        normalize_idle_minutes(store::load_settings().agent_idle_minutes)
    }

    pub(super) fn emit_idle_recycled(app: &AppHandle, session_id: &str, reason: &str) {
        let _ = app.emit(
            "session://idle_recycled",
            serde_json::json!({
                "sessionId": session_id,
                "reason": reason,
            }),
        );
    }

    pub(super) fn emit_process_limit(app: &AppHandle, session_id: Option<&str>, max: u32) {
        let _ = app.emit(
            "session://process_limit",
            serde_json::json!({
                "sessionId": session_id,
                "maxConcurrentAgents": max,
                "code": "PROCESS_LIMIT",
                "message": process_limit_message(max),
            }),
        );
    }

    /// Drop dead parked entries; return removed count (for logging).
    pub(super) fn sweep_dead_parked(&self) -> usize {
        let mut parked = self.parked.lock();
        let before = parked.len();
        parked.retain(|_, p| p.acp.is_alive());
        before.saturating_sub(parked.len())
    }

    /// Drop background shells whose ACP child is gone (stale mid-turn maps).
    pub(super) fn sweep_dead_background(&self) -> usize {
        let mut bg = self.background.lock();
        let before = bg.len();
        bg.retain(|_, s| s.acp.as_ref().is_some_and(|c| c.is_alive()));
        before.saturating_sub(bg.len())
    }

    /// Live + background process count (excludes reclaimable parked idle).
    /// Used for diagnostics / limit messaging after parked reclaim.
    pub(super) fn busy_process_count(&self) -> u32 {
        let live = self
            .inner
            .lock()
            .as_ref()
            .and_then(|s| s.acp.as_ref())
            .filter(|c| c.is_alive())
            .is_some() as u32;
        let background = self
            .background
            .lock()
            .values()
            .filter(|s| s.acp.as_ref().is_some_and(|c| c.is_alive()))
            .count() as u32;
        live + background
    }

    /// True while a turn is still in flight — must demote to `background`, never park.
    /// Includes open tools / deferred prompt_complete even if FSM already Ready
    /// (early prompt_complete + long-running find/subagent).
    pub(super) fn live_session_is_busy(s: &LiveSession) -> bool {
        // Authoritative: the prompt RPC has not resolved, so the agent is still
        // producing output for this chat no matter what the FSM says. Parking
        // here dropped the rest of the answer on the floor (parked agents get no
        // event routing) while the agent happily finished the turn.
        if s.prompt_in_flight {
            return true;
        }
        if matches!(
            s.fsm.state(),
            SessionState::Streaming | SessionState::AwaitingPermission | SessionState::Connecting
        ) {
            return true;
        }
        if s.streaming_message_id.is_some() {
            return true;
        }
        if !s.open_tool_ids.is_empty() {
            return true;
        }
        if s.deferred_prompt_complete.is_some() {
            return true;
        }
        if s.pending_plan_rpc_id.is_some() || s.pending_ask_user_rpc_id.is_some() {
            return true;
        }
        false
    }

    /// Whether connect/respawn must keep the existing agent process.
    ///
    /// Terminal FSM states (`Disconnected` / `Idle`) never preserve the process —
    /// even when leftover busy flags remain after a failed turn. Otherwise a 502
    /// (or similar) that left `deferred_prompt_complete` set would make every
    /// subsequent connect no-op as `state=Disconnected busy=true`, and the chat
    /// could not send again (Remote IM still works because it uses one-shot `grok -p`).
    pub(super) fn should_preserve_live_process(s: &LiveSession) -> bool {
        connect_should_preserve_live_process(s.fsm.state(), Self::live_session_is_busy(s))
    }

    /// Drop all in-turn busy markers after a terminal turn failure.
    /// Complements FSM `fail_with` (which only flips state + last_error).
    pub(super) fn release_failed_turn_markers(s: &mut LiveSession) {
        s.prompt_in_flight = false;
        s.streaming_message_id = None;
        Self::close_run_locked(s);
        s.stream_message_id_locked = false;
        s.stream_buf.clear();
        s.stream_thought.clear();
        s.stream_last_was_assistant = false;
        s.stream_attachments.clear();
        s.open_tool_ids.clear();
        s.open_tool_seen_at.clear();
        s.terminal_tool_ids.clear();
        s.deferred_prompt_complete = None;
        s.pending_plan_rpc_id = None;
        s.pending_ask_user_rpc_id = None;
        s.pending_stream_emit = None;
        s.journal_throttle.reset();
        s.last_stall_emit = None;
        s.stall_soft_emits = 0;
        s.saw_model_output = false;
        s.tools_this_turn = 0;
    }

    /// Park or background the current live session so focus can move.
    ///
    /// - Idle Ready (no open tools) → warm `parked`.
    /// - Busy (FSM or open tools / deferred complete) → `background` (event pump kept).
    /// - Demoting a busy turn always succeeds (never cancel for focus).
    pub(super) fn try_park_live(&self) -> Result<(), AgentError> {
        let mut guard = self.inner.lock();
        let Some(s) = guard.as_mut() else {
            return Ok(());
        };
        // Nothing to park
        if s.acp.as_ref().is_none_or(|c| !c.is_alive()) {
            // Drop dead shell so connect can rebuild.
            let _ = guard.take();
            return Ok(());
        }

        // Busy (incl. open tools while FSM Ready) → background, never park/reclaim.
        if Self::live_session_is_busy(s) {
            let Some(live) = guard.take() else {
                return Ok(());
            };
            let sid = live.app_session_id.clone();
            let st = live.fsm.state();
            let tools = live.open_tool_ids.len();
            drop(guard);
            tracing::info!(
                "acp demote busy session to background sid={sid} state={st:?} open_tools={tools}"
            );
            self.background.lock().insert(sid, live);
            return Ok(());
        }

        match s.fsm.state() {
            SessionState::Ready => {
                let acp = match s.acp.take() {
                    Some(c) if c.is_alive() => c,
                    Some(_) | None => {
                        let _ = guard.take();
                        return Ok(());
                    }
                };
                let parked = ParkedAgent {
                    process_id: s.process_id.clone(),
                    app_session_id: s.app_session_id.clone(),
                    meta: s.meta.clone(),
                    acp,
                    last_activity: s.last_activity,
                    model_id: s.model_id.clone(),
                    effort: s.effort.clone(),
                    product_mode: s.product_mode.clone(),
                    project_path: s.project_path.clone(),
                    policy: s.policy,
                    needs_history_bootstrap: s.needs_history_bootstrap,
                    backend: s.backend.clone(),
                };
                let _ = guard.take();
                drop(guard);
                self.parked
                    .lock()
                    .insert(parked.app_session_id.clone(), parked);
                Ok(())
            }
            SessionState::Idle | SessionState::Disconnected => {
                // Detach dead/idle shell without killing if no acp; drop shell.
                let _ = guard.take();
                Ok(())
            }
            other => Err(AgentError::new(
                AgentErrorCode::ProcessLimit,
                format!(
                    "Session is busy ({other:?}). Stop the turn or wait, then switch chats. {}",
                    process_limit_message(Self::max_concurrent_from_settings())
                ),
            )),
        }
    }

    /// Like `try_park_live`, then emit `session://runtime` for the demoted session.
    pub(super) fn try_park_live_emit(&self, app: &AppHandle) -> Result<(), AgentError> {
        let pre = self.inner.lock().as_ref().map(|s| {
            let busy = Self::live_session_is_busy(s);
            let mut snap = Self::snapshot_from_live(s);
            if busy && snap.state == SessionState::Ready {
                // Open tools while Ready — project as streaming so UI keeps busy.
                snap.state = SessionState::Streaming;
            }
            (busy, snap)
        });
        self.try_park_live()?;
        if let Some((busy, snap)) = pre {
            if busy {
                Self::emit_runtime(app, &snap);
            } else if snap.state == SessionState::Ready {
                let mut parked_snap = snap;
                parked_snap.streaming_message_id = None;
                Self::emit_runtime(app, &parked_snap);
            }
        }
        Ok(())
    }

    /// If a background session finished its turn (Ready, no open tools), park warm.
    pub(super) fn promote_background_ready_to_parked(&self, app_session_id: &str) {
        let mut bg = self.background.lock();
        let ready = bg.get(app_session_id).is_some_and(|s| {
            matches!(s.fsm.state(), SessionState::Ready)
                && !s.prompt_in_flight
                && s.streaming_message_id.is_none()
                && s.open_tool_ids.is_empty()
                && s.deferred_prompt_complete.is_none()
                && s.pending_plan_rpc_id.is_none()
                && s.pending_ask_user_rpc_id.is_none()
                && s.acp.as_ref().is_some_and(|c| c.is_alive())
        });
        if !ready {
            return;
        }
        let Some(mut s) = bg.remove(app_session_id) else {
            return;
        };
        drop(bg);
        let Some(acp) = s.acp.take() else {
            return;
        };
        let parked = ParkedAgent {
            process_id: s.process_id.clone(),
            app_session_id: s.app_session_id.clone(),
            meta: s.meta.clone(),
            acp,
            last_activity: s.last_activity,
            model_id: s.model_id.clone(),
            effort: s.effort.clone(),
            product_mode: s.product_mode.clone(),
            project_path: s.project_path.clone(),
            policy: s.policy,
            needs_history_bootstrap: s.needs_history_bootstrap,
            backend: s.backend.clone(),
        };
        self.parked
            .lock()
            .insert(parked.app_session_id.clone(), parked);
        tracing::info!(
            "acp background session ready → parked sid={}",
            app_session_id
        );
    }

    /// Promote a parked agent into the live slot (caller must have cleared live).
    pub(super) fn unpark_to_live(&self, app_session_id: &str) -> Option<LiveSession> {
        let parked = self.parked.lock().remove(app_session_id)?;
        if !parked.acp.is_alive() {
            return None;
        }
        let mut fsm = SessionFsm::new();
        // Parked agents were Ready; restore Ready without connect handshake.
        let _ = fsm.start_connect();
        let _ = fsm.handshake_ok();
        let now = Instant::now();
        Some(LiveSession {
            app_session_id: parked.app_session_id,
            process_id: parked.process_id,
            meta: parked.meta,
            fsm,
            backend: parked.backend,
            acp: Some(parked.acp),
            mock_stream: None,
            streaming_message_id: None,
            active_turn_id: None,
            stream_message_id_locked: false,
            stream_buf: String::new(),
            stream_thought: String::new(),
            stream_last_was_assistant: false,
            stream_attachments: Vec::new(),
            model_id: parked.model_id,
            pending_model: None,
            active_run: None,
            run_epoch_seq: 0,
            active_run_prompt: None,
            effort: parked.effort,
            product_mode: parked.product_mode,
            project_path: parked.project_path,
            allow_cache: SessionAllowCache::default(),
            policy: parked.policy,
            provider_retry_attempt: 0,
            provider_retry_aborted: false,
            needs_history_bootstrap: parked.needs_history_bootstrap,
            pending_plan_rpc_id: None,
            pending_ask_user_rpc_id: None,
            last_activity: now,
            last_stream_progress: now,
            last_stall_emit: None,
            stall_soft_emits: 0,
            journal_throttle: JournalWriteThrottle::with_default_interval(),
            open_tool_ids: HashSet::new(),
            open_tool_seen_at: HashMap::new(),
            terminal_tool_ids: HashSet::new(),
            deferred_prompt_complete: None,
            tools_this_turn: 0,
            saw_model_output: false,
            prompt_in_flight: false,
            pending_stream_emit: None,
            stream_emit_flush_gen: 0,
            last_tool_heartbeat_emit: None,
        })
    }

    /// Run `f` on a session's runtime state wherever it currently sits —
    /// the live focus slot **or** a demoted `background` turn.
    ///
    /// Session-scoped commands (permission / plan / ask_user answers) must use
    /// this instead of reaching for `self.inner`: the pending JSON-RPC id lives
    /// on the session that asked, and that session may have been demoted when
    /// the user switched chats. Answering against the live slot sent the reply
    /// to the wrong ACP child, so the background turn waited forever.
    ///
    /// Parked agents are idle Ready and hold no pending RPC — not searched.
    pub(super) fn with_session_mut<R>(
        &self,
        app_session_id: &str,
        f: impl FnOnce(&mut LiveSession) -> R,
    ) -> Option<R> {
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == app_session_id {
                    return Some(f(s));
                }
            }
        }
        let mut bg = self.background.lock();
        bg.get_mut(app_session_id).map(f)
    }

    /// True when `app_session_id` currently owns the live focus slot.
    pub(super) fn is_live_session(&self, app_session_id: &str) -> bool {
        self.inner
            .lock()
            .as_ref()
            .is_some_and(|s| s.app_session_id == app_session_id)
    }

    /// Emit the right runtime event for a session touched out-of-focus:
    /// `session://state` when it is live, `session://runtime` when demoted.
    pub(super) fn emit_for_session(&self, app: &AppHandle, app_session_id: &str) {
        if self.is_live_session(app_session_id) {
            Self::emit_state(app, &self.snapshot());
            return;
        }
        let snap = self
            .background
            .lock()
            .get(app_session_id)
            .map(Self::snapshot_from_live);
        if let Some(snap) = snap {
            Self::emit_runtime(app, &snap);
        }
    }

    /// Move `target_sid` into the live focus slot **without spawning**.
    ///
    /// Demotes the current live session first (busy → `background`, Ready →
    /// `parked`), then promotes the target from `background` / `parked`.
    /// Returns `false` when the target has no warm process — the caller must
    /// `connect` (cold spawn) instead.
    ///
    /// `send` prefers [`Self::ensure_promptable_session`] so a mid-turn live
    /// chat is not demoted when the target already has a warm background /
    /// parked agent (multi-window concurrent pool). This helper remains for
    /// callers that need the UI focus slot itself.
    ///
    /// Under `connect_lock` so a concurrent warm connect cannot swap the live
    /// slot between the caller's connect and its send (that delivered prompts
    /// into a foreign chat and left empty-journal zombie sessions behind).
    pub(super) fn focus_session(
        &self,
        app: &AppHandle,
        target_sid: &str,
    ) -> Result<bool, AgentError> {
        if self.inner.lock().as_ref().is_some_and(|s| {
            s.app_session_id == target_sid && s.acp.as_ref().is_some_and(|c| c.is_alive())
        }) {
            return Ok(true);
        }
        let in_background = self.background.lock().contains_key(target_sid);
        let in_parked = self.parked.lock().contains_key(target_sid);
        if !in_background && !in_parked {
            return Ok(false);
        }

        self.try_park_live_emit(app)?;
        // Never overwrite a shell that still holds a living ACP child.
        if self
            .inner
            .lock()
            .as_ref()
            .is_some_and(|s| s.acp.as_ref().is_some_and(|c| c.is_alive()))
        {
            self.try_park_live()?;
        }
        let _ = self.inner.lock().take();

        if in_background {
            if let Some(live) = self.background.lock().remove(target_sid) {
                *self.inner.lock() = Some(live);
                tracing::info!("acp focus: background → live sid={target_sid}");
                Self::emit_state(app, &self.snapshot());
                return Ok(true);
            }
        }
        if let Some(live) = self.unpark_to_live(target_sid) {
            *self.inner.lock() = Some(live);
            tracing::info!("acp focus: parked → live sid={target_sid}");
            Self::emit_state(app, &self.snapshot());
            return Ok(true);
        }
        // Parked process died between the check and the promote → cold spawn.
        Ok(false)
    }

    /// Ensure `target_sid` can accept a prompt **without** demoting a different
    /// mid-turn live agent when the target is already warm in the pool.
    ///
    /// Multi-window concurrent slots:
    /// - Already live → ok
    /// - Already background (busy or idle shell) → prompt in place (no promote)
    /// - Parked while live is busy on another chat → unpark into **background**
    ///   so the streaming focus is not stolen
    /// - Parked while live is free / same chat → normal focus promote
    /// - No warm process → `Ok(false)` (caller cold-connects)
    ///
    /// Must run under `connect_lock`.
    pub(super) fn ensure_promptable_session(
        &self,
        app: &AppHandle,
        target_sid: &str,
    ) -> Result<bool, AgentError> {
        // Live focus already on target with a living ACP.
        if self.inner.lock().as_ref().is_some_and(|s| {
            s.app_session_id == target_sid && s.acp.as_ref().is_some_and(|c| c.is_alive())
        }) {
            return Ok(true);
        }

        // Background: keep in place — do not demote the current live focus.
        if self
            .background
            .lock()
            .get(target_sid)
            .is_some_and(|s| s.acp.as_ref().is_some_and(|c| c.is_alive()))
        {
            tracing::info!("acp promptable: background in-place sid={target_sid} (no live demote)");
            return Ok(true);
        }

        // Parked warm: if live is mid-turn on another chat, unpark into
        // background so concurrent multi-window send does not steal focus.
        let live_busy_other = self.inner.lock().as_ref().is_some_and(|s| {
            s.app_session_id != target_sid
                && s.acp.as_ref().is_some_and(|c| c.is_alive())
                && Self::live_session_is_busy(s)
        });
        if live_busy_other && self.parked.lock().contains_key(target_sid) {
            if let Some(live) = self.unpark_to_live(target_sid) {
                // unpark_to_live builds a LiveSession; place it into background
                // so the busy live focus is not demoted.
                let sid = live.app_session_id.clone();
                let snap = Self::snapshot_from_live(&live);
                self.background.lock().insert(sid.clone(), live);
                tracing::info!(
                    "acp promptable: parked → background sid={sid} (live busy preserved)"
                );
                Self::emit_runtime(app, &snap);
                return Ok(true);
            }
            // Parked process died — fall through to focus / cold path.
        }

        // Default: promote into live focus (may demote Ready live → parked,
        // or busy live → background — never kills a busy turn).
        self.focus_session(app, target_sid)
    }

    /// Kill oldest parked agents until `need_slots` are freed (or none left).
    /// Parked = Ready idle; never touches background busy turns.
    pub(super) async fn free_parked_for_capacity(&self, app: &AppHandle, need_slots: u32) {
        if need_slots == 0 {
            return;
        }
        for _ in 0..need_slots {
            let victim = {
                let mut parked = self.parked.lock();
                let key = parked
                    .iter()
                    .min_by_key(|(_, p)| p.last_activity)
                    .map(|(k, _)| k.clone());
                key.and_then(|k| parked.remove(&k))
            };
            let Some(p) = victim else {
                break;
            };
            tracing::info!(
                "process limit: recycling parked session={} process={}",
                p.app_session_id,
                p.process_id
            );
            p.acp.kill().await;
            Self::emit_idle_recycled(app, &p.app_session_id, "capacity");
        }
    }

    /// Move every finished `background` turn into `parked`.
    ///
    /// `background` is only reclaimable via `parked`, and it is only drained on
    /// the events that end a turn. A turn that ended by any other route (error,
    /// stop, a missed completion) left its agent sitting in `background`
    /// forever: it counted against the pool but no reclaim path could ever free
    /// it, so the app reported "all slots busy" with nothing running.
    pub(super) fn sweep_finished_background_to_parked(&self) {
        let keys: Vec<String> = self.background.lock().keys().cloned().collect();
        for k in keys {
            self.promote_background_ready_to_parked(&k);
        }
    }

    /// Before spawn: reclaim idle parked until there is room (never kill busy).
    pub(super) async fn reclaim_parked_until_can_spawn(
        &self,
        app: &AppHandle,
        max_concurrent: u32,
    ) {
        self.sweep_dead_parked();
        self.sweep_dead_background();
        // Finished background turns are idle warm agents — make them reclaimable
        // before deciding the pool is full of running work.
        self.sweep_finished_background_to_parked();
        // Free enough parked slots for one new process (may free multiple).
        let active = self.active_process_count();
        let need = parked_slots_to_free_for_spawn(active, max_concurrent);
        if need > 0 {
            self.free_parked_for_capacity(app, need).await;
        }
        // If still full (e.g. free returned fewer), keep freeing until spawnable or empty.
        while !can_spawn_process(self.active_process_count(), max_concurrent) {
            let parked_n = self.parked.lock().len();
            if parked_n == 0 {
                break;
            }
            self.free_parked_for_capacity(app, 1).await;
        }
    }

    /// Idle recycle for live + parked (I03).
    pub(super) async fn tick_idle_recycle(&self, app: &AppHandle) {
        let idle_mins = Self::idle_minutes_from_settings();
        let now = Instant::now();
        self.sweep_dead_parked();
        self.sweep_dead_background();
        // Finished background turns become parked so the idle window applies.
        self.sweep_finished_background_to_parked();

        // Parked first
        let expired_parked: Vec<ParkedAgent> = {
            let mut parked = self.parked.lock();
            let keys: Vec<String> = parked
                .iter()
                .filter(|(_, p)| is_idle_expired(p.last_activity, idle_mins, now))
                .map(|(k, _)| k.clone())
                .collect();
            keys.into_iter().filter_map(|k| parked.remove(&k)).collect()
        };
        for p in expired_parked {
            tracing::info!(
                "idle recycle parked session={} after {}min",
                p.app_session_id,
                idle_mins
            );
            p.acp.kill().await;
            Self::emit_idle_recycled(app, &p.app_session_id, "idle");
        }

        // Live: only true idle Ready (never mid-turn / open tools).
        let live_kill = {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                let idle = is_idle_expired(s.last_activity, idle_mins, now);
                let ready_idle =
                    matches!(s.fsm.state(), SessionState::Ready) && !Self::live_session_is_busy(s);
                if idle && ready_idle {
                    if let Some(acp) = s.acp.take() {
                        s.fsm.soft_disconnect();
                        s.needs_history_bootstrap = false;
                        Some((s.app_session_id.clone(), acp))
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        };
        if let Some((sid, acp)) = live_kill {
            tracing::info!("idle recycle live session={sid} after {idle_mins}min");
            acp.kill().await;
            Self::emit_idle_recycled(app, &sid, "idle");
            Self::emit_state(app, &self.snapshot());
        }
    }

    pub(super) fn backend_name() -> String {
        if AcpClient::use_mock() {
            "mock_acp".into()
        } else {
            "grok_agent_stdio".into()
        }
    }

    pub fn mcp_runtime_snapshot(&self, session_id: Option<&str>) -> Option<McpRuntimeSnapshot> {
        let id = session_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| self.snapshot().session_id)?;
        self.mcp_runtime.lock().get(&id).cloned()
    }

    pub async fn mcp_runtime_current(
        &self,
        session_id: Option<&str>,
    ) -> Option<McpRuntimeSnapshot> {
        let id = session_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| self.snapshot().session_id)?;
        let mut snapshot = self
            .mcp_runtime_snapshot(Some(&id))
            .unwrap_or(McpRuntimeSnapshot {
                session_id: Some(id.clone()),
                source: "snapshot".into(),
                ..Default::default()
            });
        // A viewed session can be parked while another chat owns the live slot.
        // Its cached snapshot is still valid, and its warm ACP can still answer a
        // read-only cache query. Clone the client under short locks; never hold a
        // session map lock across the RPC await.
        let runtime = {
            let live = self
                .inner
                .lock()
                .as_ref()
                .filter(|session| session.app_session_id == id)
                .and_then(|session| {
                    session
                        .acp
                        .clone()
                        .map(|acp| (session.process_id.clone(), acp))
                });
            if live.is_some() {
                live
            } else {
                let background = self.background.lock().get(&id).and_then(|session| {
                    session
                        .acp
                        .clone()
                        .map(|acp| (session.process_id.clone(), acp))
                });
                if background.is_some() {
                    background
                } else {
                    self.parked
                        .lock()
                        .get(&id)
                        .map(|session| (session.process_id.clone(), session.acp.clone()))
                }
            }
        };
        let Some((process_id, acp)) = runtime else {
            return Some(snapshot);
        };
        if snapshot.process_id.as_deref() != Some(process_id.as_str()) {
            snapshot = McpRuntimeSnapshot {
                session_id: Some(id.clone()),
                process_id: Some(process_id.clone()),
                source: "snapshot".into(),
                ..Default::default()
            };
        }
        let cache_requested_at = chrono::Utc::now();
        let Ok(raw) = acp.mcp_list_cached().await else {
            return Some(snapshot);
        };
        // The request can outlive an ACP reconnect. A reply from the retired
        // child must never repopulate a cache that `connect` deliberately cleared.
        let active_process_id = {
            let live = self
                .inner
                .lock()
                .as_ref()
                .filter(|session| session.app_session_id == id)
                .map(|session| session.process_id.clone());
            if live.is_some() {
                live
            } else {
                let background = self
                    .background
                    .lock()
                    .get(&id)
                    .map(|session| session.process_id.clone());
                if background.is_some() {
                    background
                } else {
                    self.parked
                        .lock()
                        .get(&id)
                        .map(|session| session.process_id.clone())
                }
            }
        };
        if active_process_id.as_deref() != Some(process_id.as_str()) {
            return self.mcp_runtime_snapshot(Some(&id));
        }
        let mut merged = self
            .mcp_runtime_snapshot(Some(&id))
            .filter(|current| current.process_id.as_deref() == Some(process_id.as_str()))
            .unwrap_or(snapshot);
        merged.source = "merged".into();
        for entry in raw
            .get("servers")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            let Some(name) = entry
                .get("name")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            // Current Grok Build returns these fields at the server entry level;
            // some older relay builds wrap them under `session`. Accept both so
            // cached-list replay never turns a real ready row into `unknown`.
            let session = entry.get("session");
            let field = |name: &str| {
                entry
                    .get(name)
                    .or_else(|| session.and_then(|value| value.get(name)))
            };
            let enabled = field("enabled")
                .and_then(|value| value.as_bool())
                .unwrap_or(true);
            let auth_required = field("authRequired")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let setup_required = field("setupRequired")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let listed_status = if !enabled {
                Some("disabled".to_string())
            } else if auth_required || setup_required {
                // The GUI has one actionable non-ready badge for credentials and
                // provider setup. Never inflate either condition to `ready`.
                Some("needsAuth".to_string())
            } else {
                field("status")
                    .and_then(|value| value.as_str())
                    .map(crate::acp_client::normalize_mcp_status)
                    .map(str::to_string)
            };
            let listed_tool_count = field("toolCount")
                .and_then(|value| value.as_u64())
                .or_else(|| {
                    field("tools")
                        .and_then(|value| value.as_array())
                        .map(|items| items.len() as u64)
                })
                .and_then(|count| u32::try_from(count).ok());
            if let Some(existing) = merged.servers.iter_mut().find(|item| item.name == name) {
                // An incomplete cached-list response must not erase a richer
                // server-status event (especially its redacted failure reason).
                // Likewise, an event that landed while this cache request was
                // in flight is newer evidence than the list request started
                // before it, so keep that status and only enrich tool metadata.
                let observed_after_request =
                    chrono::DateTime::parse_from_rfc3339(&existing.observed_at)
                        .map(|observed| observed.with_timezone(&chrono::Utc) > cache_requested_at)
                        .unwrap_or(false);
                if let Some(status) = listed_status {
                    if !observed_after_request {
                        existing.status = status;
                        existing.observed_at = cache_requested_at.to_rfc3339();
                    }
                }
                if listed_tool_count.is_some() {
                    existing.tool_count = listed_tool_count;
                }
            } else {
                merged.servers.push(McpRuntimeServer {
                    name: name.to_string(),
                    status: listed_status.unwrap_or_else(|| "unknown".to_string()),
                    reason: None,
                    tool_count: listed_tool_count,
                    observed_at: cache_requested_at.to_rfc3339(),
                });
            }
        }
        self.mcp_runtime.lock().insert(id, merged.clone());
        Some(merged)
    }

    pub fn snapshot(&self) -> SessionSnapshot {
        let guard = self.inner.lock();
        match guard.as_ref() {
            None => SessionSnapshot {
                session_id: None,
                agent_session_id: None,
                state: SessionState::Idle,
                last_error: None,
                streaming_message_id: None,
                backend: Self::backend_name(),
                model_id: None,
                project_path: None,
                title: String::new(),
                active_turn_id: None,
                active_run_epoch: None,
                running_model_id: None,
                model_switch_pending: false,
                can_restart_active_run: false,
            },
            Some(s) => Self::snapshot_from_live(s),
        }
    }

    /// Runtime diagnostics for a session export package (live, background, or parked).
    /// Returns `None` when the session is not currently attached to a process.
    pub fn diagnostic_runtime_for(&self, app_session_id: &str) -> Option<serde_json::Value> {
        {
            let guard = self.inner.lock();
            if let Some(s) = guard.as_ref() {
                if s.app_session_id == app_session_id {
                    return Some(Self::live_runtime_json(s, "live"));
                }
            }
        }
        {
            let bg = self.background.lock();
            if let Some(s) = bg.get(app_session_id) {
                // Overnight / demoted busy turns live here — export must see them.
                return Some(Self::live_runtime_json(s, "background"));
            }
        }
        let parked = self.parked.lock();
        if let Some(p) = parked.get(app_session_id) {
            return Some(serde_json::json!({
                "slot": "parked",
                "state": "Ready",
                "backend": p.backend,
                "modelId": p.model_id,
                "effort": p.effort,
                "mode": p.product_mode,
                "permissionPolicy": p.policy.as_str(),
                "projectPath": p.project_path,
                "agentSessionId": p.meta.agent_session_id,
                "processId": p.process_id,
                "agentAlive": p.acp.is_alive(),
                "cwd": p.acp.cwd().display().to_string(),
                "streamingMessageId": serde_json::Value::Null,
                "toolsThisTurn": 0,
                "openToolCount": 0,
                "promptInFlight": false,
                "needsHistoryBootstrap": p.needs_history_bootstrap,
                "lastError": serde_json::Value::Null,
            }));
        }
        None
    }

    pub(super) fn live_runtime_json(s: &LiveSession, slot: &str) -> serde_json::Value {
        let cwd = s.acp.as_ref().map(|c| c.cwd().display().to_string());
        let agent_alive = s.acp.as_ref().is_some_and(|c| c.is_alive());
        serde_json::json!({
            "slot": slot,
            "state": format!("{:?}", s.fsm.state()),
            "backend": s.backend,
            "modelId": s.model_id,
            "effort": s.effort,
            "mode": s.product_mode,
            "permissionPolicy": s.policy.as_str(),
            "projectPath": s.project_path,
            "agentSessionId": s.meta.agent_session_id,
            "processId": s.process_id,
            "agentAlive": agent_alive,
            "cwd": cwd,
            "streamingMessageId": s.streaming_message_id,
            "toolsThisTurn": s.tools_this_turn,
            "openToolCount": s.open_tool_ids.len(),
            "promptInFlight": s.prompt_in_flight,
            "needsHistoryBootstrap": s.needs_history_bootstrap,
            "lastError": s.fsm.last_error().map(|e| {
                serde_json::json!({
                    "code": e.code.as_str(),
                    "message": e.message,
                })
            }),
        })
    }

    /// Keep live session meta title in sync after store rename / auto-title.
    /// Without this, later `session://state` events re-emit the stale connect-time title
    /// and wipe sidebar / header renames.
    pub fn apply_title(&self, app: &AppHandle, session_id: &str, title: &str) -> bool {
        let title = title.trim();
        if title.is_empty() {
            return false;
        }
        let mut guard = self.inner.lock();
        let Some(s) = guard.as_mut() else {
            return false;
        };
        if s.app_session_id != session_id {
            return false;
        }
        if s.meta.title == title {
            return true;
        }
        s.meta.title = title.to_string();
        s.meta.updated_at = chrono::Utc::now();
        drop(guard);
        Self::emit_state(app, &self.snapshot());
        true
    }

    pub(super) fn emit_state(app: &AppHandle, snap: &SessionSnapshot) {
        let _ = app.emit("session://state", snap);
    }

    /// Multi-session runtime for a non-focused session (background / parked).
    /// Does **not** move the live focus slot — UI projects this into `liveMap` only.
    pub(super) fn emit_runtime(app: &AppHandle, snap: &SessionSnapshot) {
        let _ = app.emit("session://runtime", snap);
    }

    pub(super) fn snapshot_from_live(s: &LiveSession) -> SessionSnapshot {
        // The run's frozen model is what produced the output on screen; the
        // session's `model_id` is what the *next* turn will use. Reporting only
        // one of them is what made a deferred switch look already applied.
        let running_model_id = s
            .active_run
            .as_ref()
            .and_then(|run| run.config.model_id.clone());
        let model_switch_pending = match (&running_model_id, &s.model_id) {
            (Some(running), Some(next)) => running != next,
            _ => s.pending_model.is_some(),
        };
        SessionSnapshot {
            session_id: Some(s.app_session_id.clone()),
            agent_session_id: s.meta.agent_session_id.clone(),
            state: s.fsm.state(),
            last_error: s.fsm.last_error().cloned(),
            streaming_message_id: s.streaming_message_id.clone(),
            backend: s.backend.clone(),
            model_id: s.model_id.clone(),
            project_path: s.project_path.clone(),
            title: s.meta.title.clone(),
            active_turn_id: s.active_run.as_ref().map(|run| run.turn_id.clone()),
            active_run_epoch: s.active_run.as_ref().map(|run| run.run_epoch),
            running_model_id,
            model_switch_pending,
            can_restart_active_run: s.active_run.is_some() && s.active_run_prompt.is_some(),
        }
    }

    /// Minimal runtime snapshot for `session://runtime` when only the session id
    /// and state are known (background lifecycle / stall recovery paths).
    ///
    /// Reports no run identity on purpose: a caller that cannot see the session
    /// must not assert whether a run is in flight.
    pub(super) fn runtime_snapshot(session_id: String, state: SessionState) -> SessionSnapshot {
        SessionSnapshot {
            session_id: Some(session_id),
            agent_session_id: None,
            state,
            last_error: None,
            streaming_message_id: None,
            backend: Self::backend_name(),
            model_id: None,
            project_path: None,
            title: String::new(),
            active_turn_id: None,
            active_run_epoch: None,
            running_model_id: None,
            model_switch_pending: false,
            can_restart_active_run: false,
        }
    }

    pub(super) fn snapshot_from_parked(p: &ParkedAgent) -> SessionSnapshot {
        SessionSnapshot {
            session_id: Some(p.app_session_id.clone()),
            agent_session_id: p.meta.agent_session_id.clone(),
            state: SessionState::Ready,
            last_error: None,
            streaming_message_id: None,
            backend: p.backend.clone(),
            model_id: p.model_id.clone(),
            project_path: p.project_path.clone(),
            title: p.meta.title.clone(),
            active_turn_id: None,
            active_run_epoch: None,
            running_model_id: None,
            model_switch_pending: false,
            can_restart_active_run: false,
        }
    }

    /// Persist + push a chat-visible error for a failed turn (retries exhausted, RPC fail, …).
    /// Updates UI via `session://turn_error` so the optimistic thinking bubble becomes a record.
    ///
    /// Content is intentionally short (code + compact reason). The UI maps codes to i18n copy
    /// and must not dump raw RPC/MCP stderr into the chat bubble.
    pub(super) fn record_turn_error(s: &mut LiveSession, app: &AppHandle, err: &AgentError) {
        let mid = s
            .streaming_message_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let code = err.code.as_str();
        let detail = sanitize_error_detail(err.message.trim());
        // Persist machine-readable code first so the frontend can i18n the summary.
        let content = if detail.is_empty() {
            format!("**{code}**")
        } else {
            format!("**{code}**\n\n{detail}")
        };
        let _ = store::append_message(
            &s.app_session_id,
            ChatMessageStored {
                id: mid.clone(),
                role: "assistant".into(),
                content: content.clone(),
                thought: None,
                created_at: chrono::Utc::now(),
                is_error: true,
                attachments: None,
                marker: None,
                tool_artifact_ref: None,
                tool_output_bytes: None,
                tool_detail_truncated: false,
            },
        );
        s.meta.updated_at = chrono::Utc::now();
        let _ = store::update_session_meta(&s.meta);
        // Clear *all* busy markers (including deferred prompt_complete / open tools).
        // Leaving them set after fail_with left the session as Disconnected+busy,
        // so connect no-oped forever and local sends failed while Remote IM still worked.
        Self::release_failed_turn_markers(s);

        let _ = app.emit(
            "session://turn_error",
            serde_json::json!({
                "sessionId": s.app_session_id,
                "messageId": mid,
                "code": code,
                "message": detail,
                "content": content,
            }),
        );
    }
}
