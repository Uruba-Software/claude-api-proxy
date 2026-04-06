#!/usr/bin/env node
/**
 * bin/claude-code-proxy.js — CLI entry point.
 *
 * Commands:
 *   claude-code-proxy setup          Interactive wizard to add API keys
 *   claude-code-proxy status         List configured keys
 *   claude-code-proxy                Start proxy + launch `claude`
 *   claude-code-proxy --no-launch    Start proxy only
 *   claude-code-proxy --port <n>     Use custom port (default: 3131)
 *   claude-code-proxy --verbose/-v   Log each request
 */

import { spawn } from 'node:child_process';
import { runSetup, printStatus } from '../src/setup.js';
import { startProxy } from '../src/proxy.js';
import { loadKeystore } from '../src/keystore.js';

const DEFAULT_PORT = 3131;
const args = process.argv.slice(2);

// ---------- helpers ----------

function parseArgs(args) {
  const opts = {
    command: null,
    port: DEFAULT_PORT,
    noLaunch: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'setup') {
      opts.command = 'setup';
    } else if (arg === 'status') {
      opts.command = 'status';
    } else if (arg === '--no-launch') {
      opts.noLaunch = true;
    } else if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true;
    } else if (arg === '--port' && args[i + 1]) {
      const p = parseInt(args[++i], 10);
      if (isNaN(p) || p < 1 || p > 65535) {
        process.stderr.write(`[claude-code-proxy] Invalid port: ${args[i]}\n`);
        process.exit(1);
      }
      opts.port = p;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--version') {
      // Read version from package.json dynamically
      import('../package.json', { with: { type: 'json' } })
        .then(({ default: pkg }) => {
          process.stdout.write(`${pkg.version}\n`);
          process.exit(0);
        })
        .catch(() => process.exit(1));
      return null; // signal async exit in progress
    }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(`
claude-code-proxy — Anthropic API key rotation proxy for Claude Code

Usage:
  claude-code-proxy setup            Add API keys interactively
  claude-code-proxy status           Show configured keys
  claude-code-proxy                  Start proxy and launch \`claude\`
  claude-code-proxy --no-launch      Start proxy only (launch claude manually)
  claude-code-proxy --port <n>       Use a custom port (default: 3131)
  claude-code-proxy --verbose/-v     Log each forwarded request
  claude-code-proxy --version        Print version
  claude-code-proxy --help           Show this help

Once the proxy is running, point Claude Code at it:
  ANTHROPIC_BASE_URL=http://127.0.0.1:3131 ANTHROPIC_API_KEY=proxy claude
`);
}

// ---------- main ----------

async function main() {
  const opts = parseArgs(args);
  if (opts === null) return; // async --version handling

  if (opts.command === 'setup') {
    await runSetup();
    return;
  }

  if (opts.command === 'status') {
    await printStatus();
    return;
  }

  // Default command: start proxy (and optionally launch claude)
  const store = await loadKeystore();
  if (!store.keys || store.keys.length === 0) {
    process.stderr.write('[claude-code-proxy] No API keys configured.\n');
    process.stderr.write('Run `claude-code-proxy setup` first.\n');
    process.exit(1);
  }

  const server = await startProxy(opts.port, { verbose: opts.verbose });

  if (opts.noLaunch) {
    process.stderr.write(
      `[claude-code-proxy] Proxy running. Launch claude manually:\n` +
      `  ANTHROPIC_BASE_URL=http://127.0.0.1:${opts.port} ANTHROPIC_API_KEY=proxy claude\n`
    );
    // Keep the process alive
    return;
  }

  // Launch `claude` with the proxy env vars injected
  process.stderr.write(`[claude-code-proxy] Launching claude...\n`);

  const claudeArgs = args.filter(
    (a) => !['--no-launch', '--verbose', '-v'].includes(a) &&
            !/^--port/.test(a) &&
            a !== String(opts.port)
  );

  const child = spawn('claude', claudeArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${opts.port}`,
      ANTHROPIC_API_KEY: 'proxy',
    },
  });

  child.on('error', (err) => {
    process.stderr.write(`[claude-code-proxy] Failed to launch claude: ${err.message}\n`);
    process.stderr.write(
      `Make sure Claude Code CLI is installed: https://claude.ai/code\n`
    );
    server.close();
    process.exit(1);
  });

  child.on('exit', (code) => {
    server.close();
    process.exit(code ?? 0);
  });

  // Forward signals to the child
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

main().catch((err) => {
  process.stderr.write(`[claude-code-proxy] Fatal error: ${err.message}\n`);
  process.exit(1);
});
