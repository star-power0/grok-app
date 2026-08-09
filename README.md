# Grok App

> 非官方桌面工作台，配合本地 Grok Build CLI 使用。

## 下载与安装

### 1. 下载 GUI

从 [Grok App Releases](https://github.com/star-power0/grok-app/releases) 下载 `grok-app-v0.2.6-windows-x64.zip`，解压后运行 `Grok.exe`。

### 2. 下载配套 CLI

从 [Grok Build 兼容性修复版 Releases](https://github.com/star-power0/grok-build/releases) 下载 `grok-build-v0.2.120-star-power0.1-windows-x64.zip`，解压后保留 `grok.exe` 与 `agent.exe` 在同一目录。

### 3. 关联二者

打开 Grok App，在设置中将 **CLI 路径** 指向上一步解压目录中的 `grok.exe`，再按原有方式登录或配置自定义站点。

GUI 与 CLI 分为两个仓库发布：GUI 是 MIT 桌面端；CLI 是 Apache-2.0 兼容性 fork。这样既能各自更新，也能清晰保留上游版权与许可证。

## 这个版本修复了什么

- 活跃自定义站点切模型时优先实时重绑，减少不必要的 Agent 重启；
- 会话流式完成事件延迟或丢失时的恢复；
- 配套 CLI 对稀疏 Responses 帧、非标准 ping 心跳、空 `finish_reason` 和工具结果图片兼容问题的处理。

VC 的 `deepseek-v4-flash` 和“射”站点是问题的实测来源；CLI 修复按协议和后端类型通用生效，不锁定某一站点或模型。

## 已知问题

冷启动后数分钟内，模型选择窗口仍可能抖动、切换响应偏慢；完成一次对话后通常恢复正常。该问题已记录，尚未修复。

## 从源码构建

要求：Node.js 22+、pnpm 9+、Rust stable，以及本地 Grok Build CLI。

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

本工作区的 Windows GNU 构建须启用 `tauri/custom-protocol`。构建产物和本地运行数据不得提交。

## 许可与归属

Grok App 源码采用 [MIT](./LICENSE)。应用通过 Agent Client Protocol 集成本地 Grok Build CLI；后者来自 SpaceXAI，采用 Apache-2.0。分发修改过的 CLI 二进制前请阅读 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

Grok App 是独立、非官方项目，不隶属于、未获 xAI 或 SpaceXAI 授权或背书。
