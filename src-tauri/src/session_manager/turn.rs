//! User turn: send, interject, stop.

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::acp_client::AcpClient;
use crate::error::AgentErrorCode;
use crate::journal_throttle::is_paragraph_break;
use crate::mock_acp::{self, StreamChunk};
use crate::session_fsm::SessionState;
use crate::store::{self, ChatMessageStored, MessageAttachmentStored};

use super::run;
use super::*;

/// If the ACP event pump is wedged when `session/prompt` resolves, its
/// PromptComplete event may never be handled and the chat stays streaming
/// forever. This fallback polls until the turn closes or the stream has been
/// quiet long enough to force-close it directly.
const AUTHORITATIVE_TURN_CLOSE_POLL_SECS: u64 = 5;
const AUTHORITATIVE_TURN_CLOSE_QUIET_SECS: u64 = 5;
const AUTHORITATIVE_TURN_CLOSE_MAX_POLLS: u32 = 12;

fn is_manual_compact_command(text: &str) -> bool {
    text.strip_prefix("/compact")
        .is_some_and(|rest| rest.is_empty() || rest.starts_with(char::is_whitespace))
}

impl SessionManager {
    pub async fn send_message(
        self: &Arc<Self>,
        app: AppHandle,
        text: String,
        display_text: Option<String>,
        attachments: Option<Vec<MessageAttachmentStored>>,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        self.dispatch_turn(app, text, display_text, attachments, session_id, None)
            .await
    }

    /// Dispatch one run.
    ///
    /// `restart_turn_id` continues an existing user turn under a new run epoch
    /// (model switch applied to the question already asked). It suppresses the
    /// duplicate user journal row, since that turn is already recorded.
    pub(super) async fn dispatch_turn(
        self: &Arc<Self>,
        app: AppHandle,
        text: String,
        display_text: Option<String>,
        attachments: Option<Vec<MessageAttachmentStored>>,
        session_id: Option<String>,
        restart_turn_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err("empty message".into());
        }
        let is_manual_compact = is_manual_compact_command(&text);
        // Retained verbatim so a restart of this turn reproduces the same input.
        let display_text_for_restart = display_text.clone();
        // Route id is read once per dispatch and frozen with the run, so a
        // provider change mid-turn cannot retroactively relabel this output.
        let provider_id = match crate::providers::active_route() {
            crate::providers::ActiveRoute::Official => Some("official".to_string()),
            crate::providers::ActiveRoute::Custom { id } => Some(id),
        };
        // Journal stores UI form when provided (skill chips); agent still receives `text`.
        let mut journal_content = display_text
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| text.clone());
        // User file/image cards — structured field is primary for history cards.
        // Also dual-write `@/abs/path` sole-lines into content so reload can recover
        // cards even if an older reader ignores the attachments field (FE strips
        // those lines via parseAttachmentsFromContent for the bubble body).
        let journal_attachments = attachments.filter(|items| !items.is_empty());
        if let Some(ref atts) = journal_attachments {
            journal_content = append_journal_attachment_refs(journal_content, atts);
        }
        // Note: image @path stripping + Host vision runs on the *final*
        // agent_prompt after history bootstrap (see below). Do not rewrite
        // here only — bootstrap can reintroduce @image paths from the journal.

        // Context compatibility preflight. Findings are surfaced, never applied:
        // no attachment is dropped or converted here. Host vision (below) is the
        // sanctioned, explicit degradation for text-only mains, so an image
        // blocker that Host vision will handle is reported as a warning instead.
        self.emit_context_compatibility(
            &app,
            session_id.as_deref(),
            journal_attachments.as_deref(),
        );

        // Serialize against connect for the whole focus + turn-open window, so
        // the slot cannot move between the target check and `begin_stream`.
        let _focus_guard = self.connect_lock.lock().await;
        if let Some(target) = session_id.as_deref() {
            match self.ensure_promptable_session(&app, target) {
                Ok(true) => {}
                Ok(false) => {
                    return Err(format!(
                        "{}: chat {target} has no live agent process — reconnect and retry",
                        AgentErrorCode::ConnectFailed.as_str()
                    ));
                }
                Err(e) => return Err(format!("{}: {}", e.code.as_str(), e.message)),
            }
        }

        // Open the turn on the target wherever it sits (live **or** background).
        // Multi-window: a secondary send must not require stealing the live focus
        // from a main-window mid-turn when the target already has a warm agent.
        let target_sid = session_id
            .clone()
            .or_else(|| self.inner.lock().as_ref().map(|s| s.app_session_id.clone()));
        let Some(app_sid) = target_sid else {
            return Err("no active session".into());
        };

        let open = self.with_session_mut(&app_sid, |s| {
            if let Some(target) = session_id.as_deref() {
                if s.app_session_id != target {
                    return Err(format!(
                        "{}: chat {target} lost focus before send — retry",
                        AgentErrorCode::ConnectFailed.as_str()
                    ));
                }
            }
            // One prompt per chat at a time. The FSM alone is not enough: an
            // early prompt_complete Readies it while the agent is still working,
            // and a second `session/prompt` would then be dispatched into a busy
            // agent (the CLI rejects it as `task_already_running`).
            if s.prompt_in_flight {
                return Err(format!(
                    "{}: chat {} is still running its previous turn",
                    AgentErrorCode::ConnectFailed.as_str(),
                    s.app_session_id
                ));
            }
            s.fsm.begin_stream().map_err(|e| e.to_string())?;
            s.prompt_in_flight = true;
            Self::touch_stream_progress_locked(s);
            // A deferred switch is applied at the turn boundary, so the run must
            // freeze the model this prompt will actually be sent with — not the
            // one the previous run used.
            let agent_model = s.pending_model.clone().or_else(|| {
                s.model_id
                    .as_deref()
                    .map(crate::providers::agent_spawn_model_id)
            });
            Self::open_run_locked(s, restart_turn_id.clone(), agent_model, provider_id.clone());
            s.active_run_prompt = Some(PendingRunPrompt {
                text: text.clone(),
                display_text: display_text_for_restart.clone(),
                attachments: journal_attachments.clone(),
            });
            s.stream_message_id_locked = false;
            let mid = Uuid::new_v4().to_string();
            s.streaming_message_id = Some(mid.clone());
            s.stream_buf.clear();
            s.stream_thought.clear();
            s.stream_last_was_assistant = false;
            s.stream_attachments.clear();
            s.journal_throttle.reset();
            s.last_stall_emit = None;
            s.open_tool_ids.clear();
            s.open_tool_seen_at.clear();
            s.terminal_tool_ids.clear();
            s.deferred_prompt_complete = None;
            s.stall_soft_emits = 0;
            s.saw_model_output = false;
            s.provider_retry_attempt = 0;
            s.provider_retry_aborted = false;
            s.tools_this_turn = 0;

            let mut agent_prompt = text.clone();
            if s.needs_history_bootstrap {
                if let Some(ctx) = build_history_bootstrap(&s.app_session_id) {
                    agent_prompt = format!("{ctx}\n{text}");
                    tracing::info!(
                        "history bootstrap attached ({} chars) for session {}",
                        ctx.len(),
                        s.app_session_id
                    );
                }
                s.needs_history_bootstrap = false;
            }
            // P2: steer session-by-UUID lookups to App/agent-home roots (avoid home-wide find).
            if let Some(hint) = session_lookup_host_hint(&text) {
                agent_prompt = format!("{hint}\n{agent_prompt}");
            }

            // persist user message (display form for skill chips on reload)
            // Journal stores the user-facing turn only — not the bootstrap wrapper.
            // Attachments are structured so history reloads image/file cards.
            //
            // A restart re-dispatches a turn that is already in the journal;
            // appending again would duplicate the question in history.
            if restart_turn_id.is_none() {
                let _ = store::append_message(
                    &s.app_session_id,
                    ChatMessageStored {
                        id: Uuid::new_v4().to_string(),
                        role: "user".into(),
                        content: journal_content.clone(),
                        thought: None,
                        created_at: chrono::Utc::now(),
                        is_error: false,
                        attachments: journal_attachments.clone(),
                        marker: None,
                        tool_artifact_ref: None,
                        tool_output_bytes: None,
                        tool_detail_truncated: false,
                    },
                );
            }
            Ok((
                s.backend.clone(),
                s.app_session_id.clone(),
                s.acp.clone(),
                agent_prompt,
                mid,
                s.model_id.clone(),
            ))
        });
        let (backend, app_sid, acp, agent_prompt, message_id, session_model_id) = match open {
            Some(Ok(v)) => v,
            Some(Err(e)) => return Err(e),
            None => {
                return Err(format!(
                    "{}: chat {app_sid} has no live agent process — reconnect and retry",
                    AgentErrorCode::ConnectFailed.as_str()
                ));
            }
        };
        // Host side-channels before main model (vision first, then X). Emit tool
        // chips immediately so the UI shows waiting state instead of freezing.
        // Copy is non-technical (no `grok -p` / command lines in chip detail).
        let locale = store::load_settings().locale;
        let zh = locale.starts_with("zh");

        // Push streaming state before long host side-channels so the pill stays
        // "进行中" (not "就绪") while recognizing.
        self.emit_for_session(&app, &app_sid);

        // ── Host vision (custom text-only main + @image only) ──────────────
        // Official Grok route: never Host-describe (native multimodal).
        // X/web: tools-first via official-aux MCP — no Host keyword pre-search.
        let host_vision =
            crate::models_aux::host_vision_will_run(&agent_prompt, session_model_id.as_deref());
        let host_tool_id = if host_vision {
            let id = format!("host-vision-{}", Uuid::new_v4());
            let (title, detail_run) = if zh {
                ("识别图片内容", "正在识别，请耐心等待…")
            } else {
                ("Recognizing image", "Working… please wait")
            };
            let _ = app.emit(
                "session://tool",
                serde_json::json!({
                    "sessionId": app_sid,
                    "toolCallId": id,
                    "title": title,
                    "kind": "vision",
                    "status": "in_progress",
                    "path": null,
                    "detail": detail_run,
                }),
            );
            self.with_session_mut(&app_sid, |s| {
                SessionManager::touch_stream_progress_locked(s);
            });
            Some((id, title.to_string()))
        } else {
            None
        };
        // Stream progress from official ACP into the *same* host-vision tool row
        // (native tool_step upsert by toolCallId — no second chip).
        let vision_progress: Option<crate::official_aux::OfficialProgressCb> =
            host_tool_id.as_ref().map(|(id, title)| {
                let app_p = app.clone();
                let sid_p = app_sid.clone();
                let tool_id = id.clone();
                let title_p = title.clone();
                let mgr = Arc::clone(self);
                std::sync::Arc::new(move |p: crate::official_aux::OfficialAcpProgress| {
                    let detail = if p.detail.trim().is_empty() {
                        if zh {
                            "正在识别…".to_string()
                        } else {
                            "Working…".to_string()
                        }
                    } else {
                        p.detail
                    };
                    // Always keep Host title; stream lives in detail only.
                    let _ = app_p.emit(
                        "session://tool",
                        serde_json::json!({
                            "sessionId": sid_p,
                            "toolCallId": tool_id,
                            "title": title_p,
                            "kind": "vision",
                            "status": "in_progress",
                            "path": null,
                            "detail": detail,
                        }),
                    );
                    mgr.with_session_mut(&sid_p, |s| {
                        SessionManager::touch_stream_progress_locked(s);
                    });
                }) as crate::official_aux::OfficialProgressCb
            });

        let prep = crate::models_aux::prepare_agent_prompt_for_main_detailed(
            &agent_prompt,
            session_model_id.as_deref(),
            vision_progress,
        )
        .await;
        let agent_prompt = prep.prompt;
        // Multimodal mains keep `@path` image refs in the prompt; the CLI only
        // reads pixels from ACP image content blocks, so split the refs out and
        // ship the files as base64 blocks (Host vision already stripped images
        // for text-only mains, so this is a no-op there).
        let (prompt_text, prompt_images) = crate::models_aux::split_prompt_images(&agent_prompt);
        if let Some((id, title)) = host_tool_id {
            let status = if prep.ok { "completed" } else { "failed" };
            // Keep full description in detail for expand / journal (not "识别完成").
            let detail = if !prep.description.trim().is_empty() {
                prep.description.clone()
            } else if prep.ok {
                if zh {
                    "识别完成".to_string()
                } else {
                    "Done".to_string()
                }
            } else if zh {
                "识别失败".to_string()
            } else {
                "Failed".to_string()
            };
            let _ = app.emit(
                "session://tool",
                serde_json::json!({
                    "sessionId": app_sid,
                    "toolCallId": id,
                    "title": title,
                    "kind": "vision",
                    "status": status,
                    "path": null,
                    "detail": detail,
                }),
            );
            journal_host_tool_step(&app_sid, &id, status, "vision", &title, &detail);
            self.with_session_mut(&app_sid, |s| {
                SessionManager::touch_stream_progress_locked(s);
            });
        }
        // Emit runtime for background targets; state for live focus.
        self.emit_for_session(&app, &app_sid);

        if backend == "mock_acp" || AcpClient::use_mock() {
            let mgr = Arc::clone(self);
            let app_done = app.clone();
            let turn_sid = app_sid.clone();
            let handle = mock_acp::spawn_fake_stream(
                app_sid.clone(),
                message_id,
                agent_prompt,
                Duration::from_millis(25),
                move |chunk: StreamChunk| {
                    let _ = app_done.emit(
                        "session://stream",
                        serde_json::json!({
                            "sessionId": chunk.session_id,
                            "messageId": chunk.message_id,
                            "text": chunk.text,
                            "done": chunk.done,
                            "kind": "assistant"
                        }),
                    );
                    mgr.with_session_mut(&turn_sid, |s| {
                        SessionManager::touch_stream_progress_locked(s);
                        s.stream_buf.push_str(&chunk.text);
                        // I04: throttle mid-stream; force on terminal done.
                        let para = is_paragraph_break(&chunk.text);
                        SessionManager::maybe_flush_stream_journal(s, chunk.done, para);
                        if chunk.done {
                            s.stream_buf.clear();
                            s.journal_throttle.reset();
                            s.last_stall_emit = None;
                            // Mock backend has no `session/prompt` RPC — its
                            // terminal chunk is the authoritative completion.
                            s.prompt_in_flight = false;
                            if s.fsm.state() == SessionState::Streaming {
                                let _ = s.fsm.end_stream();
                                s.streaming_message_id = None;
                                Self::close_run_locked(s);
                                s.stream_message_id_locked = false;
                            }
                        }
                    });
                    if chunk.done {
                        mgr.emit_for_session(&app_done, &turn_sid);
                    }
                },
            );
            self.with_session_mut(&app_sid, |s| {
                s.mock_stream = Some(handle);
            });
            // Return the target's snapshot when possible (background path).
            if self.is_live_session(&app_sid) {
                return Ok(self.snapshot());
            }
            if let Some(snap) = self
                .background
                .lock()
                .get(&app_sid)
                .map(Self::snapshot_from_live)
            {
                return Ok(snap);
            }
            return Ok(self.snapshot());
        }

        // Bail *after* the turn was opened → roll it back, or the chat is stuck
        // forever: `prompt_in_flight` blocks both parking and the next send.
        let Some(acp) = acp else {
            self.with_session_mut(&app_sid, |s| {
                s.prompt_in_flight = false;
                s.streaming_message_id = None;
                Self::close_run_locked(s);
                s.stream_message_id_locked = false;
                if s.fsm.state() == SessionState::Streaming {
                    let _ = s.fsm.end_stream();
                }
            });
            self.emit_for_session(&app, &app_sid);
            return Err("ACP client missing".into());
        };
        // A model switch requested while the previous turn was busy is applied
        // here, before this prompt, so the picker never blocks on a retrying agent.
        // The run already froze this id (see `open_run_locked`), so a failed
        // rebind must clear the frozen value instead of letting the run claim a
        // model the agent never accepted.
        let pending_model = self
            .with_session_mut(&app_sid, |s| s.pending_model.take())
            .flatten();
        if let Some(pending) = pending_model {
            if let Err(e) = acp.set_model(&pending).await {
                tracing::warn!("apply pending model {pending} before send failed: {e}");
                self.with_session_mut(&app_sid, |s| {
                    if let Some(run) = s.active_run.as_mut() {
                        run.config.agent_model_id = None;
                    }
                });
            }
        }
        let mgr = Arc::clone(self);
        let app2 = app.clone();
        let turn_sid = app_sid.clone();
        // Identity of the run this RPC belongs to. A restart supersedes the run
        // while its `session/prompt` may still be pending; without this the late
        // resolution would close or fail the run that replaced it.
        let dispatched_run = self
            .with_session_mut(&app_sid, |s| s.active_run.clone())
            .flatten();
        if is_manual_compact {
            self.manual_compact_pending.lock().insert(app_sid.clone());
        }
        tokio::spawn(async move {
            let outcome = if prompt_images.is_empty() {
                acp.prompt(&prompt_text).await
            } else {
                acp.prompt_with_images(&prompt_text, &prompt_images).await
            };
            // Re-check ownership *after* the await: this is the window a restart
            // uses. Superseded runs may not touch session turn state.
            if let Some(ref dispatched) = dispatched_run {
                let still_ours = mgr
                    .with_session_mut(&turn_sid, |s| {
                        run::event_belongs_to_run(
                            s.active_run.as_ref(),
                            Some(&dispatched.turn_id),
                            Some(dispatched.run_epoch),
                        )
                    })
                    .unwrap_or(false);
                if !still_ours {
                    tracing::info!(
                        target: "session",
                        session = %turn_sid,
                        turn = %dispatched.turn_id,
                        epoch = dispatched.run_epoch,
                        "dropping prompt RPC result from a superseded run"
                    );
                    mgr.manual_compact_pending.lock().remove(&turn_sid);
                    return;
                }
            }
            match outcome {
                Ok(stop_reason) => {
                    // The CLI completes `/compact` through x.ai/compact_conversation
                    // and normally sends no session/update marker. Synthesize the
                    // identical Host event only if a real compact update did not win.
                    if is_manual_compact && mgr.manual_compact_pending.lock().remove(&turn_sid) {
                        SessionManager::emit_context_compact(
                            &app2,
                            &turn_sid,
                            "manual".into(),
                            None,
                            None,
                            None,
                            None,
                        );
                    }
                    // The authoritative RPC result landed. The event pump should
                    // deliver PromptComplete; if it is wedged (focus/connect churn
                    // mid-turn), close the turn directly so the UI cannot stay
                    // streaming and the send queue unblocks.
                    let mgr_fb = Arc::clone(&mgr);
                    let app_fb = app2.clone();
                    let sid_fb = turn_sid.clone();
                    tokio::spawn(async move {
                        mgr_fb
                            .close_turn_after_rpc(&app_fb, &sid_fb, &stop_reason)
                            .await;
                    });
                }
                Err(e) => {
                    if is_manual_compact {
                        mgr.manual_compact_pending.lock().remove(&turn_sid);
                    }
                    // Route by session id: this chat may have been demoted to
                    // background while the prompt ran, and the live slot now holds
                    // someone else's turn — recording the error there would blame
                    // the wrong chat.
                    let mut record_error = false;
                    mgr.with_session_mut(&turn_sid, |s| {
                        // The RPC failed, so no authoritative PromptComplete will
                        // arrive. Release the turn or the chat stays un-parkable
                        // and refuses further sends.
                        s.prompt_in_flight = false;
                        // Stall heal / user stop already force-ended (Ready) with
                        // journal kept — do not clobber with fail_with when
                        // cancel/abort unblocks this waiter.
                        if !matches!(
                            s.fsm.state(),
                            SessionState::Streaming | SessionState::AwaitingPermission
                        ) {
                            return;
                        }
                        // Skip if host already recorded a retry-exhausted error this turn.
                        if !s.provider_retry_aborted {
                            SessionManager::record_turn_error(s, &app2, &e);
                            let _ = s.fsm.fail_with(e);
                            record_error = true;
                        }
                    });
                    if record_error {
                        mgr.emit_for_session(&app2, &turn_sid);
                    }
                }
            }
        });

        if self.is_live_session(&app_sid) {
            return Ok(self.snapshot());
        }
        if let Some(snap) = self
            .background
            .lock()
            .get(&app_sid)
            .map(Self::snapshot_from_live)
        {
            return Ok(snap);
        }
        Ok(self.snapshot())
    }

    /// Stop the turn on `session_id` (defaults to the live focus slot).
    ///
    /// Targets background turns too: the user can watch a demoted chat and hit
    /// Stop there, which previously cancelled whichever chat held focus.
    ///
    /// Inject guidance into the currently streaming turn without cancelling it.
    ///
    /// `session_id` names the chat (live or background). Omitting it uses the
    /// focused live slot. Does **not** rewrite the follow-up send queue.
    pub async fn interject_message<R: tauri::Runtime>(
        &self,
        app: AppHandle<R>,
        text: String,
        display_text: Option<String>,
        attachments: Option<Vec<MessageAttachmentStored>>,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err("empty interjection".into());
        }
        let mut journal_content = display_text
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| text.clone());
        let attachments = attachments.filter(|items| !items.is_empty());
        if let Some(ref atts) = attachments {
            journal_content = append_journal_attachment_refs(journal_content, atts);
        }
        let target = session_id.as_deref();

        let (backend, app_sid, run, acp) = {
            if let Some(t) = target {
                let guard = self.inner.lock();
                if let Some(s) = guard.as_ref().filter(|s| s.app_session_id == t) {
                    Self::pick_interjection_target(s)?
                } else {
                    drop(guard);
                    let background = self.background.lock();
                    let s = background
                        .get(t)
                        .ok_or_else(|| format!("interjection: chat {t} is not active"))?;
                    Self::pick_interjection_target(s)?
                }
            } else {
                let guard = self.inner.lock();
                let s = guard.as_ref().ok_or("no active session")?;
                Self::pick_interjection_target(s)?
            }
        };

        if backend != "mock_acp" && !AcpClient::use_mock() {
            acp.ok_or("ACP client missing")?.interject(&text).await?;
        }

        let created_at = chrono::Utc::now();
        let message = ChatMessageStored {
            id: Uuid::new_v4().to_string(),
            role: "user".into(),
            content: journal_content,
            thought: None,
            created_at,
            is_error: false,
            attachments,
            marker: Some("interjection".into()),
            tool_artifact_ref: None,
            tool_output_bytes: None,
            tool_detail_truncated: false,
        };

        // Session may move between live/background while the ACP RPC is in flight.
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == app_sid {
                    Self::commit_interjection_boundary(s, &app, &message, &app_sid, &run)?;
                    return Ok(self.snapshot());
                }
            }
        }
        {
            let mut background = self.background.lock();
            if let Some(s) = background.get_mut(&app_sid) {
                Self::commit_interjection_boundary(s, &app, &message, &app_sid, &run)?;
                return Ok(self.snapshot());
            }
        }

        Err("interjection turn is no longer active".into())
    }

    pub async fn stop(
        self: &Arc<Self>,
        app: AppHandle,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let target = match session_id {
            Some(sid) => sid,
            None => self
                .inner
                .lock()
                .as_ref()
                .map(|s| s.app_session_id.clone())
                .ok_or("no active session")?,
        };
        let app_for_marker = app.clone();
        let acp = self
            .with_session_mut(&target, move |s| {
                let app = app_for_marker;
                if let Some(h) = s.mock_stream.take() {
                    h.request_stop();
                }
                let was_busy = s.fsm.state() == SessionState::Streaming
                    || s.fsm.state() == SessionState::AwaitingPermission
                    || s.streaming_message_id.is_some()
                    || !s.open_tool_ids.is_empty();
                let partial = s.stream_buf.trim().to_string();
                // Journal a cancel marker so UI history is not left as user-only silence.
                if was_busy {
                    // I04: force-flush partial assistant before cancel marker.
                    Self::maybe_flush_stream_journal(s, true, false);
                    let mid = Uuid::new_v4().to_string();
                    let content = if partial.is_empty() {
                        "turn_cancelled|user_stop".to_string()
                    } else {
                        format!(
                            "turn_cancelled|user_stop|partial:{}",
                            partial.chars().take(200).collect::<String>()
                        )
                    };
                    let _ = store::append_message(
                        &s.app_session_id,
                        ChatMessageStored {
                            id: mid.clone(),
                            role: "tool".into(),
                            content: content.clone(),
                            thought: None,
                            created_at: chrono::Utc::now(),
                            is_error: false,
                            attachments: None,
                            marker: Some("turn_cancelled".into()),
                            tool_artifact_ref: None,
                            tool_output_bytes: None,
                            tool_detail_truncated: false,
                        },
                    );
                    let _ = app.emit(
                        "session://turn_marker",
                        serde_json::json!({
                            "sessionId": s.app_session_id,
                            "messageId": mid,
                            "marker": "turn_cancelled",
                            "reason": "user_stop",
                            "content": content,
                        }),
                    );
                    if s.fsm.state() == SessionState::Streaming
                        || s.fsm.state() == SessionState::AwaitingPermission
                    {
                        let _ = s.fsm.end_stream();
                    }
                }
                s.streaming_message_id = None;
                Self::close_run_locked(s);
                s.stream_message_id_locked = false;
                s.stream_buf.clear();
                s.stream_thought.clear();
                s.stream_last_was_assistant = false;
                s.stream_attachments.clear();
                s.open_tool_ids.clear();
                s.terminal_tool_ids.clear();
                s.open_tool_seen_at.clear();
                s.deferred_prompt_complete = None;
                // Cancelled: the prompt RPC resolves as cancelled, so release the
                // turn here too — otherwise the chat can never be parked again.
                s.prompt_in_flight = false;
                s.journal_throttle.reset();
                s.last_stall_emit = None;
                s.acp.clone()
            })
            .ok_or("no active session")?;
        if let Some(acp) = acp {
            let _ = acp.cancel().await;
        }
        // Stopped background turn is Ready again → park it warm.
        self.promote_background_ready_to_parked(&target);
        self.emit_for_session(&app, &target);
        Ok(self.snapshot())
    }

    /// Safety net for a wedged event pump: the `session/prompt` RPC resolved,
    /// so the turn is authoritatively done. If the pump never delivered
    /// PromptComplete (seen when focus churn/connect races block the event
    /// task), close the turn directly so the UI cannot stay streaming and the
    /// send queue unblocks.
    pub(super) async fn close_turn_after_rpc(
        self: &Arc<Self>,
        app: &AppHandle,
        app_session_id: &str,
        stop_reason: &str,
    ) {
        for _ in 0..AUTHORITATIVE_TURN_CLOSE_MAX_POLLS {
            let (finished, should_close) = self
                .with_session_mut(app_session_id, |s| {
                    if !s.prompt_in_flight {
                        return (true, false);
                    }
                    let quiet = s.last_stream_progress.elapsed()
                        >= Duration::from_secs(AUTHORITATIVE_TURN_CLOSE_QUIET_SECS);
                    (false, quiet)
                })
                .unwrap_or((true, false));
            if finished {
                return;
            }
            if should_close {
                let done = self
                    .with_session_mut(app_session_id, |s| {
                        tracing::warn!(
                            target: "session",
                            session = %app_session_id,
                            stop = stop_reason,
                            "authoritative turn close fallback fired (event pump did not close turn)"
                        );
                        Self::maybe_flush_stream_journal(s, true, false);
                        s.prompt_in_flight = false;
                        s.deferred_prompt_complete = Some(stop_reason.to_string());
                        Self::try_finish_deferred_prompt_complete(s, Some(app)).is_some()
                    })
                    .unwrap_or(false);
                if done {
                    self.emit_for_session(app, app_session_id);
                }
                return;
            }
            tokio::time::sleep(Duration::from_secs(AUTHORITATIVE_TURN_CLOSE_POLL_SECS)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_manual_compact_command;

    #[test]
    fn recognizes_only_manual_compact_commands() {
        assert!(is_manual_compact_command("/compact"));
        assert!(is_manual_compact_command("/compact keep API decisions"));
        assert!(!is_manual_compact_command("/compact-mode"));
        assert!(!is_manual_compact_command("please /compact"));
    }
}
