# Grok App

Unofficial desktop workbench for a locally installed Grok Build CLI.

Grok App manages projects, sessions, permissions, previews, custom providers, and scheduled work through the Agent Client Protocol. It does not include an API key or a hosted model service.

## Status

- VC / `deepseek-v4-flash` Responses compatibility is verified with the local patched CLI.
- A cold-start model-picker flicker and slow response remains a known GUI issue. It often disappears after the first conversation and is documented in `CHANGELOG.md`.

## Build

Requirements: Node.js 22+, pnpm 9+, Rust stable, and a local Grok Build CLI.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

For the Windows GNU build used in this workspace, build with `tauri/custom-protocol` enabled. Build artifacts and local runtime data must not be committed.

## License and Attribution

Grok App source is licensed under [MIT](./LICENSE). The app integrates with Grok Build, which is an Apache-2.0 project from SpaceXAI. Read [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) before redistributing a modified CLI binary.

Grok App is independent and unofficial. It is not affiliated with, endorsed by, or sponsored by xAI or SpaceXAI.
