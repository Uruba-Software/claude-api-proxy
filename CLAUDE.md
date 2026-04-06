# claude-api-proxy — Claude Instructions

## Release process (ALWAYS follow when pushing code changes)

Every time code is committed and pushed to main, determine whether the change
warrants a version bump. Use these rules:

| Change type | Version bump | Patch reset? | Example |
|---|---|---|---|
| Bug fix | patch: `0.1.0 → 0.1.1` | — | fix rotation logic, correct output |
| New feature (backwards-compatible) | minor: `0.1.0 → 0.2.0` | **yes, patch → 0** | new command, new option |
| Breaking change | major: `0.1.0 → 1.0.0` | yes, minor+patch → 0 | renamed command, removed flag |
| CI/docs/test only | none | — | workflow fix, README update |

**Semver rule:** when the minor version increases, patch resets to 0 (`0.1.5 → 0.2.0`, not `0.2.5`).
When the major version increases, both minor and patch reset to 0 (`0.2.3 → 1.0.0`).

### Steps to follow on every code push

1. **Update `package.json` version** FIRST if the change warrants a bump (see table above).
   - CRITICAL: The version in `package.json` MUST match the git tag. Always bump
     the version in the same commit as the code change, never after.
2. **Update `CHANGELOG.md`** — add a new `## [x.y.z] — YYYY-MM-DD` section at the top with
   a concise bullet list of what changed. This is **mandatory** for every versioned release.
3. **Commit** all changes (code + version bump + CHANGELOG) in a single commit.
   - Commit author: always `biyro02` (the configured git user) — do NOT add `Co-Authored-By` lines.
   - Write a clear, user-facing commit message — it becomes the GitHub release notes.
4. **Push** to `main`.
5. **If version was bumped**: create a GitHub release (not just a tag) so npm CI publishes
   and release notes are visible on GitHub. Extract the release notes from CHANGELOG.md:
   ```
   git tag v<new-version>
   git push origin v<new-version>
   gh release create v<new-version> --title "v<new-version>" --notes "$(awk '/^## \[<new-version>\]/{found=1; next} found && /^## \[/{exit} found{print}' CHANGELOG.md | sed '/^[[:space:]]*$/d' | head -50)"
   ```
   Example: bumping to `0.2.0`:
   - Update `package.json` → `"version": "0.2.0"`
   - Add `## [0.2.0] — YYYY-MM-DD` section to CHANGELOG.md
   - `git add . && git commit -m "feat: add remove-key command"`
   - `git push origin main`
   - `git tag v0.2.0 && git push origin v0.2.0`
   - `gh release create v0.2.0 --title "v0.2.0" --notes "$(awk '/^## \[0\.2\.0\]/{found=1; next} found && /^## \[/{exit} found{print}' CHANGELOG.md)"`

CI will then run all tests (9 combinations: 3 OS × 3 Node versions) and publish
to npm automatically if everything passes.

### What NOT to do
- Never push a tag without first pushing the matching commit to main.
- Never bump the version for CI-only, doc-only, or test-only changes.
- Never manually run `npm publish` — let CI handle it via the tag.
- Never create a GitHub release before the tag is pushed.

## Accounts & references
- GitHub org: Uruba-Software (owner: biyro02)
- GitHub repo: https://github.com/Uruba-Software/claude-api-proxy
- npm package: https://www.npmjs.com/package/claude-api-proxy
- npm publisher account: buluad
- npm token type: Granular Access Token, no 2FA required — stored as `NPM_TOKEN` in GitHub repo secrets
- Default branch: `main`
- CI: GitHub Actions (`.github/workflows/test.yml`)

## Key technical decisions & gotchas
- `--test-concurrency=1` in npm test: test files share `~/.claude-api-proxy.json`; serial execution prevents file-level race conditions
- `CLAUDE_CODE_PROXY_KEYSTORE` env var: overrides the keystore path — set it to a temp file if you need to run test files in parallel
- `makeLineReader` in setup.js: uses readline `line` event + buffer instead of `rl.question()` to avoid "readline was closed" errors with pre-filled Readable streams in tests
- `https.request` monkey-patch in proxy.test.js: since proxy.js hardcodes `api.anthropic.com`, tests replace `https.request` at the module level to redirect to a local HTTP mock
- `shell: true` on Windows: required for `spawn('claude', ...)` because the Claude Code CLI is a `.cmd` wrapper
- No external runtime dependencies: uses only Node.js 18+ built-ins (http, https, fs/promises, readline, child_process, os, path)
- ESM throughout (`"type": "module"`): use `fileURLToPath(import.meta.url)` not `import.meta.dirname` for Node 18 compatibility

## Project overview
Local HTTP proxy for Claude Code that rotates Anthropic API keys on quota/credit
exhaustion. Users install it globally: `npm install -g claude-api-proxy`.

- Runtime: Node.js ≥ 18, ESM (`"type": "module"`)
- Dependencies: none (zero runtime dependencies)
- Key storage: `~/.claude-api-proxy.json` (overridable via `CLAUDE_CODE_PROXY_KEYSTORE`)
- Default proxy port: `3131` (overridable via `--port`)
- Tests: `node:test` built-in, no external test framework
- Error types that trigger rotation: `credit_balance_too_low`, `rate_limit_error`, `overloaded_error`
- HTTP status codes that trigger rotation: `402`, `429`, `529`
