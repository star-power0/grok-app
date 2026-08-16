# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.8] - 2026-08-15

### Added
- Added a persisted compatibility master switch with per-vendor controls for Claude, Cursor, and the currently supported Codex sessions surface.
- Independent session-data mode now synchronizes the selected compatibility profile into the agent-home configuration.

### Fixed
- Reworked the Composer access picker as a fixed, single-pass sheet with stable viewport geometry, reserved scrollbar space, and native-webview overlap handling.
- Reduced Composer model/access menu re-render and positioning churn during hydration and permission changes.
- Release builds now explicitly enable Tauri custom protocol and validate the embedded frontend and NSIS artifact before deployment.

### Validation boundary
- The compatibility controls are persisted and passed through the supported agent profile and MCP spawn paths. Codex non-session resources are visibly reserved until a corresponding runtime consumer exists.
- Windows host `cargo test --lib` remains unavailable in this environment when the test binary starts (`STATUS_ENTRYPOINT_NOT_FOUND`); typecheck, lint, targeted frontend tests, Rust checks, and release builds are used as applicable.

## [0.2.7] - 2026-08-13

### 已在真实桌面会话确认
- **MCP 状态**：Host 的 session runtime snapshot、只读 `x.ai/mcp/list { cache: true }` 校正和前端
  回放已在真实软件中验证；服务器行能反映实际初始化/连接状态，不再只显示静态配置目录。
- **模型菜单稳定性**：welcome composer 固定品牌槽、菜单打开期间的数据/文案快照，以及 portal 的
  ResizeObserver + requestAnimationFrame 位置合并已在真实软件中验证，冷启动 hydration 不再导致模型
  菜单窗口抖动。
- **协议互操作**：Chat Completions 与 Responses 可在同一会话续接时更稳定地保留上下文；图片、文件、
  流式工具调用和工具结果的识别/传输均有实际改善。

### Added
- **MCP 会话 runtime snapshot + cached-list 校正**：Host 为 live/background session 保留初始化状态、
  服务器状态、原因、工具数与观测时间；前端在订阅事件前后均可读取回放快照，再以只读
  `x.ai/mcp/list { cache: true }` 校正。配置 catalog 和当前会话 health 明确分层。
- **MCP 状态脱敏与来源标注**：`mcp://init_progress`、`mcp://initialized`、
  `mcp://server_status`、`mcp://catalog_stale` 写入快照前均走脱敏路径；UI 标明
  `snapshot` / `acp_list` / `merged`，没有 live 证据时不会显示 ready。
- **模型菜单稳定性覆盖**：welcome composer 的品牌区域改为固定布局槽；模型菜单打开后冻结当前目录、
  分组、effort 和所有可见 labels，关闭后才接收下一批 hydration 数据；浮动定位为 trigger/portal panel
  安装 ResizeObserver，并用 requestAnimationFrame 与 rect 去重合并更新。
- `mcpRuntime.test.ts`、`ComposerModelMenu.snapshot.test.ts` 和 `floatingMenu.test.ts`：覆盖启动期事件早到、
  snapshot 回放、catalog 后到、旧 session 事件隔离、ready/needsAuth/unavailable 映射及菜单异步 hydration 稳定性。

### Fixed
- 配套 CLI 改进 Chat Completions / Responses 在同一对话内切换时的续接稳定性，并加强图片、文件、流式
  工具调用和工具结果的协议保留与安全降级。
- 移除一个未引用的 prompt timeout 旧别名；实际 timeout 行为仍由 idle silence 与 absolute ceiling 双重限制。

### 已知问题（暂不在本版本修复）
- **Anthropic Messages 兼容端点**：尽管已覆盖 redacted thinking、多个 thinking block 与未知合法帧，
  部分第三方 Messages 兼容端点在多轮/流式场景仍会出现协议兼容问题；本版本不宣称 Messages 已完全解决。
- **上下文/会话崩溃原因**：部分上下文相关的会话终止仍可能只表现为通用 `AGENT_CRASHED` 或断开，UI 不能
  始终给出可操作的根因；后续需在保持错误脱敏的前提下补齐 Host 分类、持久化和可见诊断。
- 本工作区的 Tauri Host `cargo test --lib mcp` 在 debug 与 release 均于测试二进制加载前失败
  （Windows `STATUS_ENTRYPOINT_NOT_FOUND`），没有执行 MCP 断言；该限制不等同于 MCP 功能失败，
  但不能作为 Host 运行时通过证据。

### Validation
- GUI：`pnpm typecheck`、`pnpm lint`、全量 `pnpm test`（348 files / 4843 tests）、Tauri
  `cargo fmt -- --check` 与 `cargo check` 已通过；本 Release 在 A 盘重新构建和打包。
- 无前台窗口回归：MCP runtime 20 项、floating menu 10 项、Composer model menu snapshot 7 项通过；
  MCP 行状态与菜单几何另由用户在真实软件中确认。

> **2026-08-11 重构第二轮**（运行生命周期冻结 / 模型切换语义 / 过期事件隔离 / 上下文兼容性接入发送路径）。

### Added
- `ActiveRun`/`FrozenRunConfig`：每次 `session/prompt` 发出时冻结模型、provider、effort 的快照；
  活跃 run 通过 `{turnId, runEpoch}` 标识，model switch 不再静默覆盖正在运行回合的模型。
- `run_epoch_seq`：per-session 单调递增，回合结束后不归零，避免晚到事件伪装成当前回合。
- `SessionSnapshot` 新增字段：`activeTurnId`、`activeRunEpoch`、`runningModelId`（本回合冻结模型）、
  `modelSwitchPending`（切换等待下一轮生效）、`canRestartActiveRun`（可用同问题重派发）。
- `PendingRunPrompt`：保留活跃回合原始输入，支持换模型后一键重发同一问题。
- `session_restart_run` Tauri 命令：中断当前回合（相同 turnId，epoch 递增）并在新模型下重派发。
- `set_model_scoped`：返回 `ModelSwitchOutcome`，报告实际执行路径（立即生效 / 延后 / 重启当前回合），
  `session_set_model` IPC 改为返回 `SetModelResult { prefs, switch }`。
- `session://context_compatibility` 事件：发送前按目标模型能力检查附件，阻止静默降级。
- `ContextAttachment::from_stored` + `classify_attachment`：按扩展名自动推断媒体类型。
- `resolve_target_capabilities`：从 provider 配置（包括 per-model `supports_vision`）推断目标模型能力。
- 组合器模型菜单 `applyNotes.model`：当 `modelSwitchPending` 时显示"下一轮生效"说明，
  `runningModelId` 有值时注明本轮仍在用哪个模型。
- 三语言 i18n 字符串：`composer.modelAppliesNextTurn`、`composer.modelAppliesNextTurnFrom`。
- `session_manager/run.rs` 新增纯函数测试 14 条（含重派发后 epoch 隔离、快照字段正确性）。

### Changed
- `active_turn_id` 赋值统一改为 `open_run_locked` / `close_run_locked`，
  消除散落的直接写法，使 turnId 生命周期与冻结配置保持同步。
- `commit_interjection_boundary`：检查条件从 `turn_id: &str` 改为 `&ActiveRun`，
  run 重启后旧 epoch 的 guidance 无法劫持新 run 的 assistant 行。
- 派发任务 spawn 携带 `dispatched_run` 快照，RPC 结果返回后先验证 run 仍为当前 run，
  已被重启超越的 epoch 的完成 / 错误回调直接丢弃，不写入新回合状态。
- `pending_model` 应用失败时清除 `active_run.config.agent_model_id`，
  避免快照谎称已切换但 agent 仍用旧模型。
- `restart_active_run` 先调 `stop` 取消旧 run，再以相同 turnId 重派发，
  两个 run 不会交错写入同一 assistant 行。
- `snapshot_from_live`：同时报告 `model_id`（下一轮）和 `running_model_id`（本轮），
  `idle` 快照补全全部新字段（带零值），消除前端字段缺失。
- `runtime_snapshot` 辅助方法：背景生命周期事件用其构造只有 sid+state 的最小 snapshot，
  不再散落六字段 struct literal。
- `sessionSetModel` TS 函数返回 `SetModelResult`（含 `switch: ModelSwitchOutcome`）；
  `SessionSnapshot` TS 类型同步新增运行身份字段。

### 验证中
- **冷启动模型选择窗口抖动**：已加入打开期间的模型/provider/文案快照、固定宽度 portal、welcome logo 固定占位槽和外层锚点观测；静态与本地 UI 检查通过，但尚待最终桌面程序的冷启动回归验证，不能在此标为已修复。
- 模型切换时 UI 菜单不再将"等下一轮才生效的切换"显示为"已切换"。
- 换模型后同一问题重发不再写入第二条 user journal 行（`restart_turn_id` 跳过入库）。
- 延迟刷新 / 已知不可用状态不再被误报为 MCP available（沿用第一轮逻辑，本轮未改动）。

> **2026-08-11 重构第一轮**（MCP 实时状态 / 工具结果可查 / 上下文兼容性校验）。

### 已实现，待桌面运行时回归

以下 MCP 状态链路已经通过前端单元测试和 Host 编译检查；在实际桌面会话验证徽标前，不应视为发布完成或替代 `mcp doctor`。

- **`/mcp` 会话运行状态回放（Host + GUI）**：CLI 在会话启动时本就异步初始化
  MCP 并推送 `x.ai/mcp/init_progress`、`x.ai/mcp_initialized`、
  `x.ai/mcp/server_status`、`x.ai/mcp/tools_changed`、`x.ai/mcp/servers_updated`，
  但 Host 的 ACP 解析器此前把这些通知全部丢弃，所以 `/mcp` 只能显示配置清单，用户
  必须再点一次 doctor 才知道哪些可用。Host 现在解码并按会话/项目作用域转发为
  `mcp://init_progress`、`mcp://initialized`、`mcp://server_status`、
  `mcp://catalog_stale`（错误原因经脱敏、未知事件安全忽略），前端按服务器逐行呈现
  `notConnected → initializing → ready / needsAuth / unavailable`。
  未知状态一律映射为 `unknown`，绝不把“没有证据”显示成可用。
- **`mcp_catalog` 统一目录来源（Host）**：`/mcp` 弹窗此前用 `grok inspect --json`，
  与会话真正注入用的 `list_mcp_server_defs` 是两套来源，可能显示与实际加载不一致。
  新命令复用注入所用的定义与启用偏好，只报告配置、不启动任何服务器，展示目标经脱敏。
- **完整工具结果可查看（Host + GUI）**：终态工具输出现在完整写入会话私有工件
  （`sessions/<id>/tool-artifacts/`），时间线只保留脱敏预览并标注是否截断。新增
  `session_tool_artifact` 只接受不透明工件引用（拒绝路径穿越）、限定当前会话、
  读取上限 2 MiB。工具行可展开加载完整结果，不再只剩 400 字符 / 8 行尾部。
- **上下文兼容性校验（Host + GUI）**：新增能力模型（图像/视频/音频/文档/文件引用/
  工具因果续接/provider 绑定续接）与校验模块，在发送或换模型前给出结构化 blocker /
  warning：视觉历史切纯文本模型、未支持的附件类型、未闭合的工具因果组、跨 provider
  的 provider-bound 续接。它不会静默丢弃或转换媒体；旧的 `supports_vision` 配置
  保持有效（缺省即 `unknown`，不假设支持）。

### Changed
- MCP 目录刷新改为事件驱动：收到 tools/servers 变更只标记 stale，仅在面板可见时
  做一次去重刷新；没有轮询，也没有前端重试循环。完整 `mcp doctor`（最长 90 秒、会
  启动全部服务器）仍保持为显式的深度诊断入口。

> **2026-08-09 第三轮**（responses 解析宽容 / 活跃站点换模型免全量回收）。

### Fixed
- **Responses 终态 usage 稀疏兼容（CLI）**：vc 的 `response.completed` 不仅会省略
  文本项的 `annotations`，还会省略 `usage.output_tokens_details.reasoning_tokens`；当前
  async-openai fork 将后者视为必填，导致 fallback 补完 annotations 后仍无法解析终态帧，
  但日志只保留第一次的 `missing field 'annotations'`，掩盖了真实第二层错误。CLI 现只在
  整个 detail 对象缺失时补 `{ "cached_tokens": 0 }` / `{ "reasoning_tokens": 0 }`，已有
  上游用量值保持原样。真实终态形状回归测试已覆盖。
- **启动期模型菜单状态收敛（GUI）**：首屏初始化已获取的 provider 路由现在与模型目录
  同批写入状态；模型选择器不再先以旧路由渲染、随后被 mount 阶段重复 `providersList`
  覆盖。避免应用刚启动时站点/模型菜单反复重排造成的抖动和“切换中”假象；后续用户操作
  仍会正常刷新路由。
- **Responses 输出帧 `annotations` 稀疏兼容（CLI）**：同一中转族（vc /
  deepseek-v4-flash）除 `response.created` 稀疏快照外，**输出帧也稀疏**——
  `response.output_item.added` 的 `OutputMessageContent::OutputText` 缺必填
  `annotations`（空数组被该中转省略），严格反序列化在输出阶段再次
  `-32603 missing field 'annotations'`、对话中断。CLI 的补洞逻辑现递归
  覆盖整棵 SSE 帧 JSON：任何 `{"type":"output_text",…}` 缺 `annotations`
  都补空数组（含 `response.output_item.added` / 终态 `response.output` 项）。
  `annotations` 仅引用列表，下游不消费，补空安全。回归测试用线上 raw 帧
  断言解析成功。
- **Responses 稀疏快照帧兼容（CLI）**：部分 Responses 中转（已确认 vc 站点的
  deepseek-v4-flash）会在 `response.created` 等早期帧里只回传**部分** `response`
  快照——缺顶层 `sequence_number`、缺 `Response::created_at` 等必填字段，严格
  反序列化器直接报废，导致 `session/prompt` 报 `-32603 serialization error`、会话
  回收（`Failed to deserialize ResponseStreamEvent … missing field 'created_at'`）。
  CLI 现对缺失的必填字段补中性默认值后再解析（`deserialize_response_event` 仅
  在严格解析失败时启用，正常帧不受影响；`created_at` 等生命周期快照字段本就不被
  下游消费，只读终态事件的 output/usage/status/error/metadata）。完整线上证据与
  修复见 `E:\GrokBuild\ITERATION-2026-08-09-model-switch-responses.md`。
- **活跃站点改请求模型不再整池回收（Host）**：composer 模型选择器只改活跃普通
  站的请求模型/目录（不带 api_key，认证未动）时，Host 现在先走实时
  `session/set_model` 重绑（与渠道切换同路径），只有实时重绑失败（模型不在 CLI
  内存注册表等）才回退 `recycle_all_agents`。此前每次改请求模型都会杀掉全部
  活跃/驻留 agent 重连（日志 `recycle reason=provider_route killed=N`），是启动
  后首次切模型慢、聊天区抖动的直接来源。

### Known Issues
- 上下文兼容性校验模块已落地并有测试覆盖，但尚未接到全部发送路径；当前不会自动阻断发送。
- 本工作区的 Rust `cargo test --lib` 目前在测试二进制启动阶段即失败
  （`STATUS_ENTRYPOINT_NOT_FOUND`，与本次改动无关），Host 侧验证以 `cargo check` 为准。

> **2026-08-09 UI 稳定性迭代**：修复会话切换时的虚拟化窗口闪动，以及账户配置提供商列表在多站点时被压缩重叠。

### Fixed
- 会话切换时，消息虚拟化高度缓存现在在布局阶段同步清理，并取消旧会话的延迟重算，避免新旧会话共用旧 spacer/window 导致聊天区域闪动。
- 打开历史会话时先切换到目标会话的缓存消息和稳定会话壳，等磁盘消息、媒体路径分类完成后再替换完整内容，避免旧会话内容挂在新会话身份下。
- 账户配置的提供商卡片固定最小高度并禁止 flex 收缩；提供商列表栏保持独立滚动，新增站点不会再挤压或覆盖已有卡片。

> **夜间迭代 2026-08-06/07**（三大问题：读图 / 流式 / 消息队列）。
> 完整过程与根因见 `E:\GrokBuild\ITERATION-2026-08-06-night.md`。

### Added
- **每模型多模态开关**：自定义站点（provider）的模型目录条目新增 `supportsVision` 字段
  （`ProviderModelEntry.supportsVision: Option<bool>`，`undefined` = 继承站点默认）。
  设置 → 自定义提供商的「请求模型」列表每行新增「多模态」复选；站点级开关成为通道默认。
  配置拉取（`/v1/models`）新增模型默认继承站点默认，可逐行覆盖。en / zh / zh-TW 三语文案。
- 预设更新：DeepSeek / OpenCode Go 预设模型默认 `supportsVision: false`（其 chat_completions
  不支持图片，避免 400）。
- **粘贴裸路径识别**（`src/lib/barePathRecognize.ts`）：用户粘贴/输入的 Windows 绝对路径
  （`"D:\…"` 带引号 / `D:\…` 裸路径 / `D:/…`）自动识别为 `@path` 引用——图片走多模态
  内容块、文件夹/文档走 CLI 工具读取，对齐 Goose `detect_image_path` / Claude Code @-mentions。
  仅验证存在的路径才转换（`paths_classify`），`C:盘`、时间 `3:30`、URL 等不误伤；
  已带 `@` 的引用不重复加。发送主路径 / 排队引导 / 编辑重发三处接入。
  - 08-07 增强：裸路径后紧跟中文提问（`D:\a\pic.png这是什么？`）时，正则会把中文吞进
    路径导致存在性校验失败。现对未命中候选做**存在性前缀修剪**（取最近存在的真实路径）
    并在转换时**用空格隔开尾巴**（`@D:\a\pic.png 这是什么？`），使下游各段 @-ref 解析
    （App `strip_inline_image_at_refs` / CLI `collect_file_references`，均按空白截断）
    都能拿到精确路径；带引号路径后贴中文、裸路径后贴标点同样隔开。

### Changed
- **读图（核心修复）**：多模态主模型发消息时，图片不再只以 `@path` 文本传给 CLI（CLI 只从 ACP
  `image` 内容块读取像素，`@path` 被当作文本文件引用）。Host 现在把 prompt 中的 `@path` 图片
  引用拆出，读盘 base64 后作为 `session/prompt` 的 ACP `image` 内容块随文本一起发送
  （`acp_client::prompt_with_images` + `models_aux::split_prompt_images`）。
- **站点级 `supports_vision` 跟随当前模型**：保存/切换模型时，`[model.<id>].supports_vision`
  取当前活跃模型的每模型标记（否则用站点默认），使 CLI 的按段视觉门控与 Composer 选择的模型一致。
- **消息队列（修复）**：`schedule_prompt_complete_fallback` 现在只完成它观察到的那一个
  `session/prompt` RPC（此前会完成所有 pending 的 prompt RPC——A 的提前 complete 会误伤已排队
  的 B，B 的回复流被当作 session 重放丢弃）。重放守卫 `is_session_load_replay` 改为同时检查
  「是否有 pending 的 session/prompt RPC」：排队回复流经时不再被误判为历史重放。

### Fixed
- **Responses 中转心跳兼容（CLI）**：部分 Responses 中转会在 SSE 流中插入非标准
  `{"type":"ping"}` 心跳帧；Grok Build 0.2.120 此前将其交给严格的 `ResponseStreamEvent`
  解析器，导致 `-32603 serialization error`，已经流出的文字会随后被 App 的网络/模型错误卡覆盖，
  `/compact` 也可能在终态前中断。CLI 现仅跳过该心跳帧，`response.failed` / `response.error`
  和真实 HTTP 502/503 仍按失败处理。完整根因与部署记录见
  `E:\GrokBuild\ITERATION-2026-08-08-responses-ping.md`。

- **Chat Completions 空 `finish_reason` 兼容（CLI）**：部分中转（已确认“射”站点）会把非终止流式 chunk 的 `finish_reason` 发成空字符串，严格枚举解析会触发 ACP `-32603` 并导致 App 回收 Agent。CLI 现将该字段的 `""` 窄范围视为未结束；合法终止值保持原语义，未知值仍报错。详见 `E:\GrokBuild\ITERATION-2026-08-08-responses-ping.md`。

- 队列消息回复丢失：任务进行中发送的排队消息，模型回复此前不可见（需切换对话或重启才显示）；
  现可实时流式显示。
- **切换模型对话崩溃（400 `AGENT_CRASHED`）**：CLI `read_file` 读图把图片 base64 放进 tool
  result 的图片内容块，而 OpenAI chat_completions / Responses 的 tool message 只接受文本内容，
  严格中转（klapi）直接 400，会话重放一并失败。现在这两个后端的 tool result 图片降级为文本
  摘要（像素仍走用户消息多模态 `@path` 路径），Anthropic messages 后端保留图片块不变
  （`chat_completions.rs` / `responses.rs`）。
- （流式）CLI 对中转 502 的指数退避（2s→30s 封顶）与 App 重试 chip 保持现状；TTFT 与中转
  网络抖动属于上游，另见迭代文档第七节建议。

### 08-07 第二轮（切换模型卡顿 / 暂停后不回 / 疑似进程崩溃）
- **自定义渠道间切换模型不再强杀 agent**：`providers_activate` 对 custom→custom 的切换改为
  落盘 `[models].default` 后直接对 live agent 发 `session/set_model`（`mgr.set_model`），
  只有目标段缺失/编辑过或 rebind 失败才回退 `recycle_all_agents`。此前每次点模型都串行
  `providersUpsert` + `providersActivate` 两次 kill + 重连，是「点击半天没反应 / 状态要重连 /
  界面抖动」的直接来源。
- **忙碌时不阻塞模型切换**：`set_model` 检测到 agent 正在 stream/重试时只记录
  `pending_model` 并立即返回；下一次发消息前先把新模型 `session/set_model` 应用再发
  prompt。上游 502 长达 40 秒的重试窗口不再让模型选择按钮假死。
- **暂停兜底**：前端 Stop 的强制完成与正常完成路径都会清 `sendInFlightRef`，避免旧
  `sessionSend` 卡住时发送队列一直拒发。
- 运行时日志发现 08-07 08:07–08:12 出现过 Windows `10055`（套接字/动态端口耗尽）：
  App 媒体服务、中继代理与 tavily/firecrawl/github 三个远程 MCP worker 全部 connect/bind
  失败，随后 agent 流 EOF。减少模型切换的 agent 重建能显著降低该类瞬时资源耗尽概率；
  系统级缓解见迭代文档（netsh 扩大动态端口 / 及时重启）。

### 验证（2026-08-07）
- 端到端图片链路通过：App 新格式图片内容块 → CLI（`shell.image_budget inline_images:1`）→
  pulseaify(gpt-5.6-terra) → 模型读出测试图 "HELLO 12345"（`A:\ClaudeWorkspace\.tmp\acp_image_wire_test.py`）。
- 新 GUI 已部署 `E:\GrokApp\Grok.exe`（27,448,832 B，旧版备份
  `Grok.exe.bak-20260807-143233`），启动健康。
- CLI conversation 模块测试 211/211 通过（含 tool result 图片降级与 Anthropic 保留图片的断言）。
- 队列修复（prompt_complete 回落 pin + 重放守卫）为代码级验证，待 GUI 实操复核。

### 08-07 第二轮验证（模型切换 / 暂停后重发）
- `cargo check --features tauri/custom-protocol` 通过；新 GUI 已部署
  `E:\GrokApp\Grok.exe`（27,460,096 B，前端指纹 `index-CCrDopD9.js`）。
- WebView2 CDP 驱动真实 GUI：
  - 忙碌中切到 Flux：日志无 `recycle_all_agents`、无阻塞 RPC，界面立即显示
    `deepseek-v4-flash`；下一条消息前先 `session/set_model` 再 `session/prompt`。
  - 503 重试中点停止：旧 prompt 以 `stop=cancelled` 结束，4 秒后新 prompt 正常发出。
- 遗留：自定义渠道切换同时改请求模型仍需一次 recycle（CLI `setModel` 不重读
  config.toml），纯渠道切换与忙碌切换已不重连、不阻塞；详细见
  `E:\GrokBuild\ITERATION-2026-08-07-model-switch-ux.md`。

## [0.2.5] - 2026-08-04

（上游基线；本仓库从 `A:\ClaudeWorkspace\.tmp\grok-app-inspect-1785901934792`（0.2.5 源码）
复制构建配置后继续迭代。）
