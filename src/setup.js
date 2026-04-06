/**
 * setup.js — Interactive CLI wizard to add/remove API keys.
 * Uses only Node.js built-in readline — no external dependencies.
 */

import readline from 'node:readline';
import { loadKeystore, saveKeystore, addKey, removeKey } from './keystore.js';

/**
 * Create a line reader that buffers incoming lines via the 'line' event.
 * This avoids the "readline was closed" error that occurs when using
 * rl.question() with a pre-filled Readable stream in tests.
 *
 * @param {NodeJS.ReadableStream} input
 * @returns {{ nextLine: () => Promise<string>, close: () => void }}
 */
function makeLineReader(input) {
  const buffered = [];
  const waiters = [];

  const rl = readline.createInterface({ input, terminal: false });
  rl.on('line', (line) => {
    if (waiters.length > 0) {
      waiters.shift()(line);
    } else {
      buffered.push(line);
    }
  });

  return {
    /** Return the next line from the input (waits if none available yet). */
    nextLine() {
      return new Promise((resolve) => {
        if (buffered.length > 0) {
          resolve(buffered.shift());
        } else {
          waiters.push(resolve);
        }
      });
    },
    close() { rl.close(); },
  };
}

/**
 * Ask a single question and return the trimmed answer.
 *
 * @param {{ nextLine: () => Promise<string> }} reader
 * @param {string} question
 * @param {NodeJS.WritableStream} output
 * @returns {Promise<string>}
 */
export async function ask(reader, question, output) {
  output.write(question);
  const answer = await reader.nextLine();
  return answer.trim();
}

/**
 * Run the interactive setup wizard.
 * Reads from `input` stream and writes to `output` stream (defaults to process
 * stdin/stdout for real use; injectable for testing).
 *
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} streams
 * @returns {Promise<void>}
 */
export async function runSetup({ input = process.stdin, output = process.stdout } = {}) {
  const reader = makeLineReader(input);

  output.write('\n[claude-code-proxy] Setup — Add your Anthropic API keys\n');
  output.write('Keys are stored in ~/.claude-code-proxy.json\n\n');

  const store = await loadKeystore();

  if (store.keys.length > 0) {
    output.write(`Currently configured keys (${store.keys.length}):\n`);
    store.keys.forEach((k, i) => {
      const marker = i === store.currentIndex ? ' ← active' : '';
      output.write(`  [${i + 1}] ${k.label}${marker}\n`);
    });
    output.write('\n');
  }

  let keepAdding = true;
  while (keepAdding) {
    const label = await ask(reader, 'Key label (e.g. "work", "personal") [leave blank to finish]: ', output);
    if (!label) {
      keepAdding = false;
      break;
    }

    // Check for duplicate labels
    if (store.keys.some((k) => k.label === label)) {
      output.write(`  ⚠  A key with label "${label}" already exists. Choose a different label.\n`);
      continue;
    }

    const key = await ask(reader, `API key for "${label}" (sk-ant-...): `, output);
    if (!key.startsWith('sk-ant-')) {
      output.write('  ⚠  That does not look like an Anthropic API key (expected sk-ant-...). Skipping.\n');
      continue;
    }

    addKey(store, label, key);
    output.write(`  ✓  Added key "${label}"\n\n`);

    const another = await ask(reader, 'Add another key? (y/N): ', output);
    keepAdding = another.toLowerCase() === 'y';
  }

  reader.close();

  if (store.keys.length === 0) {
    output.write('\nNo keys configured. Re-run `claude-code-proxy setup` to add keys.\n\n');
    return;
  }

  await saveKeystore(store);
  output.write(`\n✓ Saved ${store.keys.length} key(s) to ~/.claude-code-proxy.json\n`);
  output.write('Run `claude-code-proxy status` to verify, then `claude-code-proxy` to start.\n\n');
}

/**
 * Print the status of all configured keys to the given output stream.
 *
 * @param {{ output?: NodeJS.WritableStream }} streams
 * @returns {Promise<void>}
 */
export async function printStatus({ output = process.stdout } = {}) {
  const store = await loadKeystore();

  if (store.keys.length === 0) {
    output.write('[claude-code-proxy] No keys configured. Run: claude-code-proxy setup\n');
    return;
  }

  output.write('\n[claude-code-proxy] Configured API keys:\n\n');
  store.keys.forEach((k, i) => {
    const active = i === store.currentIndex ? ' ← active' : '';
    const masked = k.key.slice(0, 12) + '...' + k.key.slice(-4);
    output.write(`  [${i + 1}] ${k.label.padEnd(20)} ${masked}${active}\n`);
  });
  output.write('\n');
}
