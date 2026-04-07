# Changelog

## [0.2.0] — 2026-04-07

- Add `claude-api-proxy use <label>` command to manually switch the active key without waiting for quota exhaustion — useful for testing and explicit key selection

## [0.1.0] — 2026-04-06

Initial release.

- Local HTTP proxy server on port 3131 (configurable with `--port`)
- Automatic API key rotation on quota/credit exhaustion (HTTP 402/429/529)
- Supports `credit_balance_too_low`, `rate_limit_error`, and `overloaded_error` error types
- Interactive setup wizard (`claude-api-proxy setup`) to add labeled API keys
- Key status display (`claude-api-proxy status`)
- Proxy + auto-launch Claude Code (`claude-api-proxy`)
- Proxy-only mode (`--no-launch`)
- Verbose request logging (`--verbose` / `-v`)
- Key storage in `~/.claude-api-proxy.json`
- No runtime dependencies — Node.js 18+ built-ins only
- Works on Linux, macOS, and Windows
