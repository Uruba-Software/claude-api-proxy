# Contributing to claude-api-proxy

## Local dev setup

```bash
git clone https://github.com/Uruba-Software/claude-api-proxy.git
cd claude-api-proxy
npm link          # makes `claude-api-proxy` available globally from this working copy
```

Run tests:

```bash
npm test
```

Tests use Node's built-in `node:test` runner — no external test framework needed.

---

## Project layout

```
bin/
  claude-api-proxy.js    CLI entry point — arg parsing, command dispatch, spawns claude
src/
  keystore.js             Load/save ~/.claude-api-proxy.json, key rotation logic
  proxy.js                HTTP proxy server — forwards requests, detects exhaustion, retries
  setup.js                Interactive wizard (readline) + printStatus
test/
  keystore.test.js        Unit tests for rotation logic, exhaustion detection
  proxy.test.js           Integration tests — mock upstream, verify rotation+retry
  setup.test.js           Tests for setup wizard (non-interactive, injected input)
.github/
  workflows/
    test.yml              CI: test matrix (3 OS × 3 Node) + npm publish on tag
```

---

## Key technical decisions

- **`--test-concurrency=1`** — test files share `~/.claude-api-proxy.json` by default; concurrency 1 prevents race conditions. Set `CLAUDE_CODE_PROXY_KEYSTORE` to a temp path to run files in parallel.
- **`makeLineReader` pattern in setup.js** — avoids `readline was closed` errors when testing with a pre-filled Readable stream. Uses the `line` event to buffer lines and resolves `nextLine()` promises from the buffer instead of using `rl.question()`.
- **`https.request` monkey-patch in proxy.test.js** — proxy.js hardcodes `api.anthropic.com`. Tests redirect outgoing HTTPS to a local plain HTTP mock by replacing `https.request` at the module level.
- **`shell: true` on Windows** — required for spawning `claude` on Windows (the CLI is a `.cmd` file that needs a shell to execute).
- **`import.meta` not `import.meta.dirname`** — `import.meta.dirname` is Node 22+ only. Use `fileURLToPath(import.meta.url)` for Node 18+ compatibility.
- **No external runtime dependencies** — the project uses only Node.js 18+ built-ins (`http`, `https`, `fs/promises`, `readline`, `child_process`).

---

## Making changes

1. Fork the repo and create a feature branch.
2. Make your changes. Add or update tests under `test/`.
3. Run `npm test` — all 35 tests must pass.
4. Open a pull request against `main`.

CI runs on every PR: 3 OS (Linux, macOS, Windows) × 3 Node versions (18, 20, 22) = 9 combinations.

---

## Release process (maintainers)

See [CLAUDE.md](CLAUDE.md) for the full release checklist (version bump rules, CHANGELOG format, tagging, and npm publish via CI).

Short version:
1. Bump version in `package.json` + add `CHANGELOG.md` section in the same commit.
2. Push to `main`.
3. `git tag v<version> && git push origin v<version>`
4. `gh release create v<version> --title "v<version>" --notes "$(awk ...  CHANGELOG.md)"`

CI publishes to npm automatically when a `v*` tag is pushed and all tests pass.
