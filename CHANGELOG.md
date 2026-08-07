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
- （流式）CLI 对中转 502 的指数退避（2s→30s 封顶）与 App 重试 chip 保持现状；TTFT 与中转
  网络抖动属于上游，另见迭代文档第七节建议。

### 验证（2026-08-07）
- 端到端图片链路通过：App 新格式图片内容块 → CLI（`shell.image_budget inline_images:1`）→
  pulseaify(gpt-5.6-terra) → 模型读出测试图 "HELLO 12345"（`A:\ClaudeWorkspace\.tmp\acp_image_wire_test.py`）。
- 新 GUI 已部署 `E:\GrokApp\Grok.exe`（27,448,832 B，旧版备份
  `Grok.exe.bak-0807-20260807-084127`），启动健康。
- 队列修复（prompt_complete 回落 pin + 重放守卫）为代码级验证，待 GUI 实操复核。

## [0.2.5] - 2026-08-04

（上游基线；本仓库从 `A:\ClaudeWorkspace\.tmp\grok-app-inspect-1785901934792`（0.2.5 源码）
复制构建配置后继续迭代。）
