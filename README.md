<p align="center">
  <h1 align="center">claude-code-proxy</h1>
  <p align="center">Anthropic API key rotation proxy for Claude Code — seamlessly switch keys when one account's quota runs out.</p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/claude-code-proxy"><img src="https://img.shields.io/npm/v/claude-code-proxy?color=cb3837&label=npm&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/claude-code-proxy"><img src="https://img.shields.io/npm/dm/claude-code-proxy?color=cb3837&logo=npm&label=downloads" alt="npm downloads"></a>
  <a href="https://github.com/Uruba-Software/claude-code-proxy/actions/workflows/test.yml"><img src="https://github.com/Uruba-Software/claude-code-proxy/actions/workflows/test.yml/badge.svg" alt="CI"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/claude-code-proxy?color=339933&logo=node.js&logoColor=white" alt="Node.js version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/claude-code-proxy?color=blue" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Linux-supported-FCC624?logo=linux&logoColor=black" alt="Linux">
  <img src="https://img.shields.io/badge/macOS-supported-000000?logo=apple&logoColor=white" alt="macOS">
  <img src="https://img.shields.io/badge/Windows-supported-0078D4?logo=windows&logoColor=white" alt="Windows">
</p>

---

```
claude-code-proxy setup      # add your API keys
claude-code-proxy            # start proxy + launch Claude Code
claude-code-proxy status     # see which key is active
```

---

## How it works

`claude-code-proxy` runs a local HTTP proxy on port `3131`. It starts Claude Code as a child process with `ANTHROPIC_BASE_URL` pointing at the proxy. Every API request is forwarded to `api.anthropic.com` with the currently active key injected.

When a quota or credit exhaustion error is detected (`402`, `429`, `529` / `credit_balance_too_low`, `rate_limit_error`, `overloaded_error`), the proxy silently rotates to the next configured key and retries — without interrupting your Claude Code session.

```
[claude-code-proxy] ⚡ KEY ROTATED: work → personal
```

If all keys are exhausted, the original error is passed back to Claude Code unchanged.

---

## Requirements

- **[Node.js](https://nodejs.org)** 18+
- **[Claude Code](https://claude.ai/code)** installed and in your PATH

---

## Install

```bash
npm install -g claude-code-proxy
```

---

## Quick start

**1. Add your API keys:**

```bash
claude-code-proxy setup
```

```
[claude-code-proxy] Setup — Add your Anthropic API keys
Keys are stored in ~/.claude-code-proxy.json

Key label (e.g. "work", "personal") [leave blank to finish]: work
API key for "work" (sk-ant-...): sk-ant-api03-...
  ✓  Added key "work"

Add another key? (y/N): y
Key label (e.g. "work", "personal") [leave blank to finish]: personal
API key for "personal" (sk-ant-...): sk-ant-api03-...
  ✓  Added key "personal"

Add another key? (y/N): n

✓ Saved 2 key(s) to ~/.claude-code-proxy.json
```

**2. Start the proxy and Claude Code:**

```bash
claude-code-proxy
```

That's it. Claude Code launches automatically with the proxy configured. When the first key hits its quota, the proxy rotates to the next key transparently.

---

## Commands

### `claude-code-proxy setup`

Interactive wizard to add API keys. Stores them in `~/.claude-code-proxy.json`.

### `claude-code-proxy status`

List all configured keys with their labels and which one is currently active.

```
[claude-code-proxy] Configured API keys:

  [1] work                 sk-ant-api03...xxxx ← active
  [2] personal             sk-ant-api03...yyyy
```

### `claude-code-proxy`

Start the proxy on port `3131` and launch `claude` with the correct environment variables injected (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`).

### `claude-code-proxy --no-launch`

Start the proxy only. Useful if you want to launch Claude Code manually or connect another tool.

```bash
claude-code-proxy --no-launch
# Proxy running. Launch claude manually:
#   ANTHROPIC_BASE_URL=http://127.0.0.1:3131 ANTHROPIC_API_KEY=proxy claude
```

### `claude-code-proxy --port <n>`

Use a custom port instead of the default `3131`.

```bash
claude-code-proxy --port 8080
```

### `claude-code-proxy --verbose` / `-v`

Log each forwarded request and which key is being used to stderr.

```
[claude-code-proxy] → POST /v1/messages (key: work)
```

---

## Key storage

Keys are stored in `~/.claude-code-proxy.json`:

```json
{
  "keys": [
    { "label": "work",     "key": "sk-ant-...", "active": true },
    { "label": "personal", "key": "sk-ant-...", "active": true }
  ],
  "currentIndex": 0
}
```

The proxy rotates `currentIndex` forward on exhaustion. After cycling through all keys, it resets. The file is updated on disk after each rotation so the active key persists across restarts.

---

## Platform support

| Platform | Status |
|---|---|
| **Linux** | ✅ Supported |
| **macOS** | ✅ Supported |
| **Windows** | ✅ Supported |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local dev setup, architecture notes, and the release process.

---

## License

MIT — see [LICENSE](LICENSE).
