/**
 * test/use-command.test.js — Tests for `claude-api-proxy use <label>` command.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { loadKeystore, saveKeystore } from '../src/keystore.js';
import * as keystoreModule from '../src/keystore.js';

async function writeTestKeystore(data) {
  await writeFile(keystoreModule.KEYSTORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function cleanKeystore() {
  try { await unlink(keystoreModule.KEYSTORE_PATH); } catch { /* ok */ }
}

afterEach(cleanKeystore);

test('use command switches active key by label', async () => {
  await writeTestKeystore({
    keys: [
      { label: 'work',     key: 'sk-ant-work',     active: true },
      { label: 'personal', key: 'sk-ant-personal', active: true },
    ],
    currentIndex: 0,
  });

  // Simulate what `claude-api-proxy use personal` does
  const store = await loadKeystore();
  const idx = store.keys.findIndex((k) => k.label === 'personal');
  assert.equal(idx, 1);
  store.currentIndex = idx;
  await saveKeystore(store);

  const updated = await loadKeystore();
  assert.equal(updated.currentIndex, 1);
  assert.equal(updated.keys[updated.currentIndex].label, 'personal');
});

test('use command stays on same key if already active', async () => {
  await writeTestKeystore({
    keys: [
      { label: 'work', key: 'sk-ant-work', active: true },
    ],
    currentIndex: 0,
  });

  const store = await loadKeystore();
  const idx = store.keys.findIndex((k) => k.label === 'work');
  store.currentIndex = idx;
  await saveKeystore(store);

  const updated = await loadKeystore();
  assert.equal(updated.currentIndex, 0);
});

test('use command returns -1 for unknown label', async () => {
  await writeTestKeystore({
    keys: [
      { label: 'work', key: 'sk-ant-work', active: true },
    ],
    currentIndex: 0,
  });

  const store = await loadKeystore();
  const idx = store.keys.findIndex((k) => k.label === 'nonexistent');
  assert.equal(idx, -1);
});
