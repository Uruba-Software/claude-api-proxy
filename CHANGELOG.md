# Changelog

## [0.1.0] — 2025-04-06

Initial release.

- Local HTTP proxy server on port 3131 (configurable with `--port`)
- Automatic API key rotation on quota/credit exhaustion (HTTP 402/429/529)
- Supports `credit_balance_too_low`, `rate_limit_error`, and `overloaded_error` error types
- Interactive setup wizard (`claude-code-proxy setup`) to add labeled API keys
- Key status display (`claude-code-proxy status`)
- Proxy + auto-launch Claude Code (`claude-code-proxy`)
- Proxy-only mode (`--no-launch`)
- Verbose request logging (`--verbose` / `-v`)
- Key storage in `~/.claude-code-proxy.json`
- No runtime dependencies — Node.js 18+ built-ins only
- Works on Linux, macOS, and Windows
