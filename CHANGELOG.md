# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- 队列消息回复丢失：任务进行中发送的排队消息，模型回复此前不可见（需切换对话或重启才显示）；
  现可实时流式显示。
- **切换模型对话崩溃（400 `AGENT_CRASHED`）**：CLI `read_file` 读图把图片 base64 放进 tool
  result 的图片内容块，而 OpenAI chat_completions / Responses 的 tool message 只接受文本内容，
  严格中转（klapi）直接 400，会话重放一并失败。现在这两个后端的 tool result 图片降级为文本
  摘要（像素仍走用户消息多模态 `@path` 路径），Anthropic messages 后端保留图片块不变
  （`chat_completions.rs` / `responses.rs`）。
- （流式）CLI 对中转 502 的指数退避（2s→30s 封顶）与 App 重试 chip 保持现状；TTFT 与中转
  网络抖动属于上游，另见迭代文档第七节建议。

### 验证（2026-08-07）
- 端到端图片链路通过：App 新格式图片内容块 → CLI（`shell.image_budget inline_images:1`）→
  pulseaify(gpt-5.6-terra) → 模型读出测试图 "HELLO 12345"（`A:\ClaudeWorkspace\.tmp\acp_image_wire_test.py`）。
- 新 GUI 已部署 `E:\GrokApp\Grok.exe`（27,448,832 B，旧版备份
  `Grok.exe.bak-20260807-143233`），启动健康。
- CLI conversation 模块测试 211/211 通过（含 tool result 图片降级与 Anthropic 保留图片的断言）。
- 队列修复（prompt_complete 回落 pin + 重放守卫）为代码级验证，待 GUI 实操复核。

## [0.2.5] - 2026-08-04

（上游基线；本仓库从 `A:\ClaudeWorkspace\.tmp\grok-app-inspect-1785901934792`（0.2.5 源码）
复制构建配置后继续迭代。）
