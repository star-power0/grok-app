# Grok App

> 非官方桌面工作台，配合本地 Grok Build CLI 使用。

## 下载与安装

### 1. 下载 GUI

从 [Grok App Releases](https://github.com/star-power0/grok-app/releases) 下载 `Grok-v0.2.8-windows-x64.zip`，解压后运行 `Grok.exe`。

### 2. 下载配套 CLI

从 [Grok Build 兼容性修复版 Releases](https://github.com/star-power0/grok-build/releases) 下载 `grok-cli-v0.2.120-star-power0.3-windows-x64.zip`，解压后保留 `grok.exe` 与 `agent.exe` 在同一目录。

### 3. 关联二者

打开 Grok App，在设置中将 **CLI 路径** 指向上一步解压目录中的 `grok.exe`，再按原有方式登录或配置自定义站点。

GUI 与 CLI 分为两个仓库发布：GUI 是 MIT 桌面端；CLI 是 Apache-2.0 兼容性 fork。这样既能各自更新，也能清晰保留上游版权与许可证。

## 0.2.8 已验证的改进

- **`/mcp` 实时状态**：会话级 runtime snapshot、`x.ai/mcp/list { cache: true }` 校正和状态事件回放已在真实桌面会话验证；服务器行会反映初始化、可用、需授权或不可用状态，而不是只显示静态配置。
- **Composer 菜单稳定性**：模型菜单在打开期间冻结目录与文案快照；权限选择器改为固定、单次定位的 Access Sheet，保留滚动条空间并避开原生 WebView，因此不会因内容测量反复重新锚定而抖动。
- **第三方 IDE 兼容性**：设置页提供可持久化的总开关和细粒度开关。Claude 与 Cursor 的 Skills、MCP、Agents、Rules、Hooks、Sessions 会写入独立 Agent profile，并作为共享模式下的子进程局部覆盖；Codex 当前仅支持 Sessions，其他单元会明确显示为保留项。
- **同会话协议续接**：Chat Completions 与 Responses 的连续对话切换更稳定；图片和文件的识别/传输、流式工具调用和工具结果回传均有实际改善。
- **工具结果可见性**：终态输出写入会话私有工件，时间线保留脱敏预览并可展开查看全文。
- **安全兼容层**：配套 CLI 对未知合法的 provider-bound 数据尽量保留；无法安全跨协议表达的内容会显示可见标记，而不静默丢失。详见 CLI 的 `FORK_CHANGES.md`。

### 验证边界

- 已通过：GUI typecheck / lint / 全量 Vitest（349 files / 4847 tests）、Tauri custom-protocol `cargo check`、MCP snapshot/state reducer，以及权限 Sheet 的几何单测。
- 权限 Sheet 已在真实 Chrome 中连续 120 帧验证为单一 `420 × 640` 面板且几何稳定；MCP 状态、模型菜单稳定性及上述 Chat/Responses、附件和流式工具路径已由用户在真实软件中确认。
- 本机 Tauri Host 的 `cargo test --lib mcp` 仍会在测试二进制加载前失败（Windows `STATUS_ENTRYPOINT_NOT_FOUND`）；`cargo check` 与 release build 可通过，但该限制不等于 Host MCP 断言已运行。

VC 的 `deepseek-v4-flash` 和“射”站点是问题的实测来源；CLI 修复按协议和后端类型通用生效，不锁定某一站点或模型。

## 已知问题

- **Anthropic Messages 协议**：已覆盖的 thinking、未知帧和附件路径有所改善，但部分第三方 Messages 兼容端点在多轮或流式场景仍有协议问题；此项已记录，后续单独修复。
- **上下文/会话崩溃原因**：部分上下文相关的会话终止仍可能只显示通用 `AGENT_CRASHED` 或断开，不能始终反馈可操作的根因；后续会在继续脱敏的前提下补齐分类、持久化和 UI 诊断。
- 上下文兼容性校验模块已有覆盖，但尚未接入全部发送路径；当前不会自动阻断所有不兼容续接。
- 本工作区的 Rust `cargo test --lib` 目前在测试二进制启动阶段即失败（`STATUS_ENTRYPOINT_NOT_FOUND`，与本次改动无关），Host 侧验证以 `cargo check` 为准。

## 从源码构建

要求：Node.js 22+、pnpm 9+、Rust stable，以及本地 Grok Build CLI。

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

本工作区的 Windows 发布构建须启用 `tauri/custom-protocol`，以嵌入 `dist/` 前端而非在启动后连接开发期 `localhost`。源码、工具链、缓存和构建产物保留在 A 盘；E 盘仅用于最终部署二进制及其运行数据。构建产物和本地运行数据不得提交。

## 许可与归属

Grok App 源码采用 [MIT](./LICENSE)。应用通过 Agent Client Protocol 集成本地 Grok Build CLI；后者来自 SpaceXAI，采用 Apache-2.0。分发修改过的 CLI 二进制前请阅读 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

Grok App 是独立、非官方项目，不隶属于、未获 xAI 或 SpaceXAI 授权或背书。
