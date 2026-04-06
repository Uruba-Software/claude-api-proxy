/**
 * keystore.js — Load/save ~/.claude-api-proxy.json, key rotation logic.
 *
 * Key file schema:
 * {
 *   "keys": [{ "label": "work", "key": "sk-ant-...", "active": true }],
 *   "currentIndex": 0
 * }
 */

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Return the absolute path to the key storage file.
 * Can be overridden via CLAUDE_CODE_PROXY_KEYSTORE env var — used in tests
 * to avoid concurrent test files colliding on the real user keystore.
 *
 * @returns {string}
 */
export function getKeystorePath() {
  return process.env.CLAUDE_CODE_PROXY_KEYSTORE
    ?? join(homedir(), '.claude-api-proxy.json');
}

/** @deprecated Use getKeystorePath() — kept for direct reference in tests. */
export const KEYSTORE_PATH = getKeystorePath();

/** Error types that indicate quota/credit exhaustion and should trigger rotation. */
export const EXHAUSTION_ERROR_TYPES = new Set([
  'credit_balance_too_low',
  'rate_limit_error',
  'overloaded_error',
]);

/** HTTP status codes that indicate quota/credit exhaustion. */
export const EXHAUSTION_STATUS_CODES = new Set([402, 429, 529]);

/**
 * Load the keystore from disk.
 * Returns a default empty store if the file does not exist.
 *
 * @returns {Promise<{keys: Array<{label: string, key: string, active: boolean}>, currentIndex: number}>}
 */
export async function loadKeystore() {
  const path = getKeystorePath();
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { keys: [], currentIndex: 0 };
    }
    throw new Error(`Failed to read keystore at ${path}: ${err.message}`);
  }
}

/**
 * Save the keystore to disk.
 *
 * @param {{keys: Array, currentIndex: number}} store
 * @returns {Promise<void>}
 */
export async function saveKeystore(store) {
  await writeFile(getKeystorePath(), JSON.stringify(store, null, 2), 'utf8');
}

/**
 * Return the API key string for the current index, or null if no keys exist.
 *
 * @param {{keys: Array<{key: string}>, currentIndex: number}} store
 * @returns {string|null}
 */
export function getActiveKey(store) {
  if (!store.keys || store.keys.length === 0) return null;
  const idx = store.currentIndex % store.keys.length;
  return store.keys[idx].key;
}

/**
 * Return the label of the key at the given index.
 *
 * @param {{keys: Array<{label: string}>}} store
 * @param {number} index
 * @returns {string}
 */
export function getLabelAt(store, index) {
  return store.keys[index]?.label ?? `key-${index}`;
}

/**
 * Rotate to the next key in the store.
 * Returns { rotated, fromLabel, toLabel } — rotated is false when all keys
 * have been tried (full cycle without success).
 *
 * @param {{keys: Array, currentIndex: number}} store
 * @param {number} [startIndex] - The index we started from; used to detect full cycle.
 * @returns {{ rotated: boolean, fromLabel: string, toLabel: string }}
 */
export function rotateKey(store, startIndex) {
  if (!store.keys || store.keys.length <= 1) {
    return { rotated: false, fromLabel: getLabelAt(store, store.currentIndex), toLabel: '' };
  }

  const fromIndex = store.currentIndex;
  const fromLabel = getLabelAt(store, fromIndex);

  // Advance to the next key (wraps around)
  store.currentIndex = (store.currentIndex + 1) % store.keys.length;
  const toLabel = getLabelAt(store, store.currentIndex);

  // If we've looped back to where we started, all keys are exhausted
  const origin = startIndex ?? 0;
  const rotated = store.currentIndex !== origin;

  return { rotated, fromLabel, toLabel };
}

/**
 * Detect whether an HTTP response indicates quota/key exhaustion.
 * Works for both non-streaming (parsed JSON body) and streaming (SSE error event).
 *
 * @param {number} statusCode
 * @param {object|null} body - Parsed response body, or null for streaming checks.
 * @returns {boolean}
 */
export function isExhaustionError(statusCode, body) {
  if (EXHAUSTION_STATUS_CODES.has(statusCode)) {
    // Further check: if body available, confirm error type
    if (body?.error?.type) {
      return EXHAUSTION_ERROR_TYPES.has(body.error.type);
    }
    return true; // status code alone is sufficient
  }
  return false;
}

/**
 * Add a new key to the store. Returns the updated store.
 *
 * @param {{keys: Array, currentIndex: number}} store
 * @param {string} label
 * @param {string} key
 * @returns {{keys: Array, currentIndex: number}}
 */
export function addKey(store, label, key) {
  store.keys.push({ label, key, active: true });
  return store;
}

/**
 * Remove a key by label from the store. Returns the updated store.
 * Resets currentIndex if it pointed at or past the removed key.
 *
 * @param {{keys: Array, currentIndex: number}} store
 * @param {string} label
 * @returns {{keys: Array, currentIndex: number}}
 */
export function removeKey(store, label) {
  const idx = store.keys.findIndex((k) => k.label === label);
  if (idx === -1) throw new Error(`No key with label "${label}" found.`);
  store.keys.splice(idx, 1);
  if (store.currentIndex >= store.keys.length) {
    store.currentIndex = 0;
  }
  return store;
}
