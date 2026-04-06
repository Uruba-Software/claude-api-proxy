/**
 * test/keystore.test.js — Unit tests for keystore.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getActiveKey,
  getLabelAt,
  rotateKey,
  isExhaustionError,
  addKey,
  removeKey,
  EXHAUSTION_STATUS_CODES,
  EXHAUSTION_ERROR_TYPES,
} from '../src/keystore.js';

// ── getActiveKey ───────────────────────────────────────────────────────────

test('getActiveKey returns null for empty store', () => {
  assert.equal(getActiveKey({ keys: [], currentIndex: 0 }), null);
});

test('getActiveKey returns the key at currentIndex', () => {
  const store = {
    keys: [
      { label: 'a', key: 'sk-ant-aaa' },
      { label: 'b', key: 'sk-ant-bbb' },
    ],
    currentIndex: 1,
  };
  assert.equal(getActiveKey(store), 'sk-ant-bbb');
});

test('getActiveKey wraps around if index is out of bounds', () => {
  const store = {
    keys: [{ label: 'a', key: 'sk-ant-aaa' }],
    currentIndex: 5,
  };
  // 5 % 1 === 0
  assert.equal(getActiveKey(store), 'sk-ant-aaa');
});

// ── getLabelAt ─────────────────────────────────────────────────────────────

test('getLabelAt returns label at given index', () => {
  const store = { keys: [{ label: 'work' }, { label: 'personal' }] };
  assert.equal(getLabelAt(store, 0), 'work');
  assert.equal(getLabelAt(store, 1), 'personal');
});

test('getLabelAt returns fallback for missing index', () => {
  const store = { keys: [] };
  assert.equal(getLabelAt(store, 2), 'key-2');
});

// ── rotateKey ──────────────────────────────────────────────────────────────

test('rotateKey advances to next key', () => {
  const store = {
    keys: [
      { label: 'a', key: 'sk-ant-aaa' },
      { label: 'b', key: 'sk-ant-bbb' },
    ],
    currentIndex: 0,
  };
  const result = rotateKey(store, 0);
  assert.equal(store.currentIndex, 1);
  assert.equal(result.fromLabel, 'a');
  assert.equal(result.toLabel, 'b');
  assert.equal(result.rotated, true);
});

test('rotateKey wraps around to index 0', () => {
  const store = {
    keys: [
      { label: 'a', key: 'sk-ant-aaa' },
      { label: 'b', key: 'sk-ant-bbb' },
    ],
    currentIndex: 1,
  };
  const result = rotateKey(store, 0);
  assert.equal(store.currentIndex, 0);
  // wrapped back to start index — all keys exhausted
  assert.equal(result.rotated, false);
});

test('rotateKey returns rotated=false for single key', () => {
  const store = {
    keys: [{ label: 'only', key: 'sk-ant-aaa' }],
    currentIndex: 0,
  };
  const result = rotateKey(store, 0);
  assert.equal(result.rotated, false);
});

test('rotateKey handles three keys correctly', () => {
  const store = {
    keys: [
      { label: 'a', key: 'sk-ant-aaa' },
      { label: 'b', key: 'sk-ant-bbb' },
      { label: 'c', key: 'sk-ant-ccc' },
    ],
    currentIndex: 0,
  };
  const r1 = rotateKey(store, 0);
  assert.equal(store.currentIndex, 1);
  assert.equal(r1.rotated, true);

  const r2 = rotateKey(store, 0);
  assert.equal(store.currentIndex, 2);
  assert.equal(r2.rotated, true);

  const r3 = rotateKey(store, 0);
  assert.equal(store.currentIndex, 0); // wrapped
  assert.equal(r3.rotated, false); // full cycle
});

// ── isExhaustionError ──────────────────────────────────────────────────────

test('isExhaustionError returns true for exhaustion status codes without body', () => {
  for (const code of EXHAUSTION_STATUS_CODES) {
    assert.equal(isExhaustionError(code, null), true, `Expected true for ${code}`);
  }
});

test('isExhaustionError returns true for exhaustion body error types', () => {
  for (const type of EXHAUSTION_ERROR_TYPES) {
    assert.equal(
      isExhaustionError(429, { error: { type } }),
      true,
      `Expected true for ${type}`
    );
  }
});

test('isExhaustionError returns false for 200', () => {
  assert.equal(isExhaustionError(200, null), false);
});

test('isExhaustionError returns false for 400 with auth error', () => {
  assert.equal(isExhaustionError(400, { error: { type: 'authentication_error' } }), false);
});

test('isExhaustionError returns false for 429 with non-exhaustion body', () => {
  // If body has a type, it must be in the exhaustion set
  assert.equal(isExhaustionError(429, { error: { type: 'authentication_error' } }), false);
});

test('isExhaustionError returns true for 429 with credit_balance_too_low', () => {
  assert.equal(
    isExhaustionError(429, { error: { type: 'credit_balance_too_low' } }),
    true
  );
});

// ── addKey / removeKey ─────────────────────────────────────────────────────

test('addKey appends a new key', () => {
  const store = { keys: [], currentIndex: 0 };
  addKey(store, 'test', 'sk-ant-test');
  assert.equal(store.keys.length, 1);
  assert.equal(store.keys[0].label, 'test');
  assert.equal(store.keys[0].key, 'sk-ant-test');
  assert.equal(store.keys[0].active, true);
});

test('removeKey removes by label', () => {
  const store = {
    keys: [
      { label: 'a', key: 'sk-ant-aaa', active: true },
      { label: 'b', key: 'sk-ant-bbb', active: true },
    ],
    currentIndex: 0,
  };
  removeKey(store, 'a');
  assert.equal(store.keys.length, 1);
  assert.equal(store.keys[0].label, 'b');
});

test('removeKey resets currentIndex when it points past end', () => {
  const store = {
    keys: [
      { label: 'a', key: 'sk-ant-aaa', active: true },
      { label: 'b', key: 'sk-ant-bbb', active: true },
    ],
    currentIndex: 1,
  };
  removeKey(store, 'b'); // removes index 1, now only 1 key remains
  assert.equal(store.currentIndex, 0);
});

test('removeKey throws for unknown label', () => {
  const store = { keys: [{ label: 'a', key: 'sk-ant-aaa', active: true }], currentIndex: 0 };
  assert.throws(() => removeKey(store, 'nonexistent'), /No key with label/);
});
