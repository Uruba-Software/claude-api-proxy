/**
 * test/setup.test.js — Tests for setup wizard logic (non-interactive).
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { writeFile, unlink } from 'node:fs/promises';
import { loadKeystore, saveKeystore } from '../src/keystore.js';
import * as keystoreModule from '../src/keystore.js';
import { runSetup, printStatus } from '../src/setup.js';

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a Readable stream from a string (simulates user typing in readline).
 */
function makeInput(text) {
  const r = new Readable({ read() {} });
  r.push(text);
  r.push(null);
  return r;
}

/**
 * Capture text written to a Writable stream into a string.
 */
function makeOutput() {
  let captured = '';
  const w = new Writable({
    write(chunk, _enc, cb) {
      captured += chunk.toString();
      cb();
    },
  });
  w.getText = () => captured;
  return w;
}

async function cleanKeystore() {
  try { await unlink(keystoreModule.KEYSTORE_PATH); } catch { /* ok */ }
}

async function writeKeystore(data) {
  await writeFile(keystoreModule.KEYSTORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ── tests ──────────────────────────────────────────────────────────────────

// Clean keystore after each test to avoid cross-test contamination
afterEach(cleanKeystore);

test('setup wizard adds a single key', async () => {
  await cleanKeystore();

  // Simulates: label="work", key="sk-ant-abc123xxxx", no more keys (blank label)
  const input = makeInput('work\nsk-ant-abc123xxxx\nn\n');
  const output = makeOutput();

  await runSetup({ input, output });

  const store = await loadKeystore();
  assert.equal(store.keys.length, 1);
  assert.equal(store.keys[0].label, 'work');
  assert.equal(store.keys[0].key, 'sk-ant-abc123xxxx');
  assert.ok(output.getText().includes('Added key "work"'));
});

test('setup wizard adds multiple keys', async () => {
  await cleanKeystore();

  // label1 → key1 → y (add more) → label2 → key2 → n (done)
  const input = makeInput('alpha\nsk-ant-aaaaaaaaaaa\ny\nbeta\nsk-ant-bbbbbbbbbbb\nn\n');
  const output = makeOutput();

  await runSetup({ input, output });

  const store = await loadKeystore();
  assert.equal(store.keys.length, 2);
  assert.equal(store.keys[0].label, 'alpha');
  assert.equal(store.keys[1].label, 'beta');
});

test('setup wizard rejects invalid API key format', async () => {
  await cleanKeystore();

  // Provide a bad key, then blank label to exit
  const input = makeInput('test\nnot-a-real-key\n\n');
  const output = makeOutput();

  await runSetup({ input, output });

  const store = await loadKeystore();
  assert.equal(store.keys.length, 0);
  assert.ok(output.getText().includes('does not look like an Anthropic API key'));
});

test('setup wizard rejects duplicate label', async () => {
  await cleanKeystore();
  await writeKeystore({
    keys: [{ label: 'work', key: 'sk-ant-existing', active: true }],
    currentIndex: 0,
  });

  // Try duplicate label "work", then blank to exit
  const input = makeInput('work\n\n');
  const output = makeOutput();

  await runSetup({ input, output });

  const store = await loadKeystore();
  assert.equal(store.keys.length, 1); // still only 1
  assert.ok(output.getText().includes('already exists'));
});

test('setup wizard exits cleanly on blank label', async () => {
  await cleanKeystore();

  // Immediately press Enter (blank label) → exit
  const input = makeInput('\n');
  const output = makeOutput();

  await runSetup({ input, output });

  const store = await loadKeystore();
  assert.equal(store.keys.length, 0);
  assert.ok(output.getText().includes('No keys configured'));
});

// ── printStatus ────────────────────────────────────────────────────────────

test('printStatus prints no-keys message when empty', async () => {
  await cleanKeystore();

  const output = makeOutput();
  await printStatus({ output });
  assert.ok(output.getText().includes('No keys configured'));
});

test('printStatus lists keys with active marker', async () => {
  await writeKeystore({
    keys: [
      { label: 'work', key: 'sk-ant-workxxxxxxxxxxxxxxx', active: true },
      { label: 'personal', key: 'sk-ant-personalxxxxxxxxx', active: true },
    ],
    currentIndex: 1,
  });

  const output = makeOutput();
  await printStatus({ output });

  const text = output.getText();
  assert.ok(text.includes('work'));
  assert.ok(text.includes('personal'));
  assert.ok(text.includes('← active'));
  // The active marker should be on the "personal" entry (index 1)
  const lines = text.split('\n').filter((l) => l.includes('←'));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('personal'));
});

test('printStatus masks the key value', async () => {
  await writeKeystore({
    keys: [{ label: 'secret', key: 'sk-ant-ABCDEFGHIJKLMNOP', active: true }],
    currentIndex: 0,
  });

  const output = makeOutput();
  await printStatus({ output });

  const text = output.getText();
  // Full key should not appear
  assert.ok(!text.includes('ABCDEFGHIJKLMNOP'));
  // Masked version should contain ellipsis
  assert.ok(text.includes('...'));
});
