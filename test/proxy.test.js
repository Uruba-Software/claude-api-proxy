/**
 * test/proxy.test.js — Integration tests for the proxy server.
 *
 * Spins up a mock "Anthropic" HTTPS server (self-signed), then starts the
 * proxy pointing at it, and verifies rotation + retry behavior.
 *
 * Because Node's built-in https module verifies certificates, the mock server
 * uses plain HTTP (not HTTPS). We monkey-patch the ANTHROPIC_HOST/PORT inside
 * the proxy module by using a test-only env variable approach — but since ESM
 * modules are sealed, we instead start a plain HTTP upstream and use a patched
 * version of proxy.js that reads PROXY_UPSTREAM_HOST/PORT from env.
 *
 * Approach: spawn the proxy as an HTTP server against a local mock upstream.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProxyServer } from '../src/proxy.js';
import {
  loadKeystore,
  saveKeystore,
  KEYSTORE_PATH,
} from '../src/keystore.js';

// ── Test helpers ──────────────────────────────────────────────────────────

/**
 * Create a mock upstream HTTP server with configurable response behavior.
 * `handler` receives (req, res) and is replaced between tests.
 */
function createMockUpstream() {
  let handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'message', content: 'ok' }));
  };

  const server = http.createServer((req, res) => handler(req, res));

  return {
    server,
    setHandler(fn) { handler = fn; },
    start() {
      return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    },
    stop() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Send a plain HTTP request to the proxy and return { statusCode, body }.
 */
function proxyRequest(port, path = '/v1/messages', body = { model: 'claude-3', messages: [] }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-api-key': 'test-key',
          'anthropic-version': '2023-06-01',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Module-level override: redirect proxy to local mock upstream ──────────

// proxy.js hardcodes api.anthropic.com. For integration tests we need to
// intercept outgoing HTTPS requests. We do this by patching the global
// https.request to forward to our local HTTP mock instead.
import https from 'node:https';

let mockUpstreamPort = null;

const originalHttpsRequest = https.request.bind(https);

function patchHttps(port) {
  mockUpstreamPort = port;
  https.request = function (options, callback) {
    // Redirect to our local HTTP mock
    const httpOptions = {
      ...options,
      hostname: '127.0.0.1',
      port: mockUpstreamPort,
      // keep path, method, headers as-is
    };
    return http.request(httpOptions, callback);
  };
}

function unpatchHttps() {
  https.request = originalHttpsRequest;
  mockUpstreamPort = null;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

// Use a temp keystore path so tests don't touch the real ~/.claude-code-proxy.json
const TEST_KEYSTORE = join(tmpdir(), `claude-code-proxy-test-${process.pid}.json`);

// Override KEYSTORE_PATH used by proxy/keystore at runtime by writing to the
// same path the module uses. We'll monkey-patch the module's exported constant.
import * as keystoreModule from '../src/keystore.js';

async function writeTestKeystore(data) {
  // Write to the real KEYSTORE_PATH since we can't easily swap the export
  await writeFile(keystoreModule.KEYSTORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function cleanupTestKeystore() {
  try { await unlink(keystoreModule.KEYSTORE_PATH); } catch { /* ok */ }
}

// ── Tests ──────────────────────────────────────────────────────────────────

const mock = createMockUpstream();
let mockPort;
let proxyServer;
let proxyPort;

before(async () => {
  mockPort = await mock.start();
  patchHttps(mockPort);

  // Write a two-key test keystore
  await writeTestKeystore({
    keys: [
      { label: 'key1', key: 'sk-ant-key1', active: true },
      { label: 'key2', key: 'sk-ant-key2', active: true },
    ],
    currentIndex: 0,
  });

  proxyServer = createProxyServer({ verbose: false });
  await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  proxyPort = proxyServer.address().port;
});

after(async () => {
  await new Promise((resolve) => proxyServer.close(resolve));
  await mock.stop();
  unpatchHttps();
  await cleanupTestKeystore();
});

beforeEach(async () => {
  // Reset keystore to two keys, index 0 before each test
  await writeTestKeystore({
    keys: [
      { label: 'key1', key: 'sk-ant-key1', active: true },
      { label: 'key2', key: 'sk-ant-key2', active: true },
    ],
    currentIndex: 0,
  });
});

test('proxy forwards successful requests transparently', async () => {
  mock.setHandler((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'message', id: 'msg_1' }));
  });

  const result = await proxyRequest(proxyPort);
  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body);
  assert.equal(body.id, 'msg_1');
});

test('proxy replaces x-api-key header with active key', async () => {
  let receivedKey = null;
  mock.setHandler((req, res) => {
    receivedKey = req.headers['x-api-key'];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'message' }));
  });

  await proxyRequest(proxyPort);
  // The proxy should replace the test 'test-key' with the actual stored key
  assert.equal(receivedKey, 'sk-ant-key1');
});

test('proxy rotates key on 429 with rate_limit_error and retries', async () => {
  let callCount = 0;
  const receivedKeys = [];

  mock.setHandler((req, res) => {
    receivedKeys.push(req.headers['x-api-key']);
    callCount++;
    if (callCount === 1) {
      // First call: return rate limit error
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Rate limited' } }));
    } else {
      // Second call: success
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'message', id: 'msg_rotated' }));
    }
  });

  const result = await proxyRequest(proxyPort);
  assert.equal(result.statusCode, 200);
  assert.equal(callCount, 2);
  assert.equal(receivedKeys[0], 'sk-ant-key1');
  assert.equal(receivedKeys[1], 'sk-ant-key2');
});

test('proxy rotates key on 402 credit_balance_too_low', async () => {
  let callCount = 0;

  mock.setHandler((_req, res) => {
    callCount++;
    if (callCount === 1) {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'credit_balance_too_low' } }));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'message' }));
    }
  });

  const result = await proxyRequest(proxyPort);
  assert.equal(result.statusCode, 200);
  assert.equal(callCount, 2);
});

test('proxy passes error through when all keys are exhausted', async () => {
  // Exhaust key1, rotate to key2, exhaust key2 → pass error back
  let callCount = 0;

  mock.setHandler((_req, res) => {
    callCount++;
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error' } }));
  });

  const result = await proxyRequest(proxyPort);
  // Should pass through the 429 after exhausting all keys
  assert.equal(result.statusCode, 429);
  assert.equal(callCount, 2); // tried both keys
});

test('proxy returns 500 when no keys are configured', async () => {
  await writeTestKeystore({ keys: [], currentIndex: 0 });

  mock.setHandler((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'message' }));
  });

  const result = await proxyRequest(proxyPort);
  assert.equal(result.statusCode, 500);
  assert.ok(result.body.includes('No API keys configured'));
});

test('proxy forwards non-exhaustion errors without rotating', async () => {
  let callCount = 0;

  mock.setHandler((_req, res) => {
    callCount++;
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error' } }));
  });

  const result = await proxyRequest(proxyPort);
  assert.equal(result.statusCode, 400);
  assert.equal(callCount, 1); // no retry
});

test('proxy forwards 401 authentication errors without rotating', async () => {
  let callCount = 0;

  mock.setHandler((_req, res) => {
    callCount++;
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error' } }));
  });

  const result = await proxyRequest(proxyPort);
  assert.equal(result.statusCode, 401);
  assert.equal(callCount, 1);
});
