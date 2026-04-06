/**
 * proxy.js — Local HTTP proxy server that forwards requests to api.anthropic.com,
 * rotating API keys automatically on quota/credit exhaustion errors.
 */

import http from 'node:http';
import https from 'node:https';
import { loadKeystore, saveKeystore, getActiveKey, rotateKey, isExhaustionError, getLabelAt } from './keystore.js';

const ANTHROPIC_HOST = 'api.anthropic.com';
const ANTHROPIC_PORT = 443;

/**
 * Print a rotation notice to stderr.
 *
 * @param {string} fromLabel
 * @param {string} toLabel
 */
function logRotation(fromLabel, toLabel) {
  process.stderr.write(`[claude-code-proxy] ⚡ KEY ROTATED: ${fromLabel} → ${toLabel}\n`);
}

/**
 * Forward a single request to Anthropic, replacing the x-api-key header.
 * Returns { statusCode, headers, body } where body is a Buffer.
 *
 * @param {string} apiKey
 * @param {string} method
 * @param {string} path
 * @param {object} incomingHeaders
 * @param {Buffer} bodyBuffer
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer}>}
 */
function forwardRequest(apiKey, method, path, incomingHeaders, bodyBuffer) {
  return new Promise((resolve, reject) => {
    // Build outgoing headers: copy all from Claude Code, override only x-api-key
    const outHeaders = { ...incomingHeaders };
    outHeaders['host'] = ANTHROPIC_HOST;
    outHeaders['x-api-key'] = apiKey;
    // Remove transfer-encoding: chunked to avoid double-chunking
    delete outHeaders['transfer-encoding'];

    const options = {
      hostname: ANTHROPIC_HOST,
      port: ANTHROPIC_PORT,
      path,
      method,
      headers: outHeaders,
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    if (bodyBuffer.length > 0) req.write(bodyBuffer);
    req.end();
  });
}

/**
 * Forward a streaming request to Anthropic, piping SSE events back to the client.
 * Monitors SSE events for exhaustion errors and signals via the returned promise.
 *
 * Resolves with { exhausted: boolean, fromLabel, toLabel } after the stream ends
 * or an exhaustion event is detected.
 *
 * @param {string} apiKey
 * @param {string} method
 * @param {string} path
 * @param {object} incomingHeaders
 * @param {Buffer} bodyBuffer
 * @param {http.ServerResponse} clientRes
 * @param {boolean} verbose
 * @returns {Promise<{exhausted: boolean}>}
 */
function forwardStreamingRequest(apiKey, method, path, incomingHeaders, bodyBuffer, clientRes, verbose) {
  return new Promise((resolve, reject) => {
    const outHeaders = { ...incomingHeaders };
    outHeaders['host'] = ANTHROPIC_HOST;
    outHeaders['x-api-key'] = apiKey;
    delete outHeaders['transfer-encoding'];

    const options = {
      hostname: ANTHROPIC_HOST,
      port: ANTHROPIC_PORT,
      path,
      method,
      headers: outHeaders,
    };

    const req = https.request(options, (res) => {
      // For streaming, we only detect exhaustion at the HTTP status level first
      if (isExhaustionError(res.statusCode, null)) {
        // Drain the response body to free the socket, then signal exhaustion
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ exhausted: true, rawBody: Buffer.concat(chunks) }));
        return;
      }

      // Write response headers back to the client
      clientRes.writeHead(res.statusCode, res.headers);

      let sseBuffer = '';
      let exhaustionDetected = false;

      res.on('data', (chunk) => {
        if (exhaustionDetected) return;

        // Accumulate SSE text to inspect events
        sseBuffer += chunk.toString('utf8');

        // Check each SSE event in the buffer
        const lines = sseBuffer.split('\n');
        // Keep the last (potentially incomplete) line in the buffer
        sseBuffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data?.type === 'error' && isExhaustionError(res.statusCode, { error: data.error })) {
                exhaustionDetected = true;
                // Signal exhaustion — Claude Code will retry; the next request
                // will hit the proxy with the already-rotated key
                resolve({ exhausted: true });
                return;
              }
            } catch {
              // Not JSON, skip
            }
          }
        }

        // Pipe the chunk to the client as-is
        clientRes.write(chunk);
      });

      res.on('end', () => {
        if (!exhaustionDetected) {
          clientRes.end();
          resolve({ exhausted: false });
        }
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    if (bodyBuffer.length > 0) req.write(bodyBuffer);
    req.end();
  });
}

/**
 * Collect the full request body as a Buffer.
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Determine whether the request expects a streaming (SSE) response.
 *
 * @param {http.IncomingMessage} req
 * @param {Buffer} bodyBuffer
 * @returns {boolean}
 */
function isStreamingRequest(req, bodyBuffer) {
  const accept = req.headers['accept'] ?? '';
  if (accept.includes('text/event-stream')) return true;
  try {
    const body = JSON.parse(bodyBuffer.toString('utf8'));
    return body?.stream === true;
  } catch {
    return false;
  }
}

/**
 * Create and return the HTTP proxy server.
 *
 * @param {{ verbose?: boolean }} options
 * @returns {http.Server}
 */
export function createProxyServer({ verbose = false } = {}) {
  const server = http.createServer(async (req, res) => {
    const bodyBuffer = await collectBody(req).catch((err) => {
      res.writeHead(500);
      res.end(`Proxy error reading request body: ${err.message}`);
      return null;
    });
    if (bodyBuffer === null) return;

    const streaming = isStreamingRequest(req, bodyBuffer);

    // Load keystore fresh for every request to pick up any out-of-band changes
    const store = await loadKeystore().catch((err) => {
      res.writeHead(500);
      res.end(`Proxy error loading keystore: ${err.message}`);
      return null;
    });
    if (store === null) return;

    if (!store.keys || store.keys.length === 0) {
      res.writeHead(500);
      res.end('[claude-code-proxy] No API keys configured. Run: claude-code-proxy setup\n');
      return;
    }

    const startIndex = store.currentIndex;
    let attempts = 0;
    const maxAttempts = store.keys.length;

    while (attempts < maxAttempts) {
      const apiKey = getActiveKey(store);
      const label = getLabelAt(store, store.currentIndex);

      if (verbose) {
        process.stderr.write(`[claude-code-proxy] → ${req.method} ${req.url} (key: ${label})\n`);
      }

      if (streaming) {
        // eslint-disable-next-line no-await-in-loop
        const result = await forwardStreamingRequest(
          apiKey,
          req.method,
          req.url,
          req.headers,
          bodyBuffer,
          res,
          verbose
        ).catch((err) => ({ error: err }));

        if (result.error) {
          if (!res.headersSent) res.writeHead(502);
          res.end(`Proxy upstream error: ${result.error.message}`);
          return;
        }

        if (!result.exhausted) {
          // Stream completed successfully
          return;
        }

        // Exhaustion detected — rotate and let Claude Code retry
        const { rotated, fromLabel, toLabel } = rotateKey(store, startIndex);
        if (rotated) {
          logRotation(fromLabel, toLabel);
          await saveKeystore(store).catch(() => {}); // best-effort persist
        }
        // End the response so Claude Code retries the request
        if (!res.headersSent) res.writeHead(429);
        res.end();
        return;
      } else {
        // Non-streaming: buffer full response, check for exhaustion, retry if needed
        // eslint-disable-next-line no-await-in-loop
        const result = await forwardRequest(
          apiKey,
          req.method,
          req.url,
          req.headers,
          bodyBuffer
        ).catch((err) => ({ error: err }));

        if (result.error) {
          if (!res.headersSent) res.writeHead(502);
          res.end(`Proxy upstream error: ${result.error.message}`);
          return;
        }

        let body = result.body;
        let parsedBody = null;
        try {
          parsedBody = JSON.parse(body.toString('utf8'));
        } catch {
          // binary or non-JSON response
        }

        if (isExhaustionError(result.statusCode, parsedBody)) {
          attempts++;
          const { rotated, fromLabel, toLabel } = rotateKey(store, startIndex);
          if (!rotated) {
            // All keys exhausted — pass original error back to Claude Code
            res.writeHead(result.statusCode, result.headers);
            res.end(body);
            return;
          }
          logRotation(fromLabel, toLabel);
          await saveKeystore(store).catch(() => {}); // best-effort persist
          continue; // retry with new key
        }

        // Success or non-exhaustion error — forward as-is
        res.writeHead(result.statusCode, result.headers);
        res.end(body);
        return;
      }
    }

    // Exhausted all retries
    res.writeHead(429);
    res.end('[claude-code-proxy] All API keys exhausted.\n');
  });

  return server;
}

/**
 * Start the proxy server on the given port.
 *
 * @param {number} port
 * @param {{ verbose?: boolean }} options
 * @returns {Promise<http.Server>}
 */
export function startProxy(port, options = {}) {
  return new Promise((resolve, reject) => {
    const server = createProxyServer(options);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      process.stderr.write(`[claude-code-proxy] Proxy listening on http://127.0.0.1:${port}\n`);
      resolve(server);
    });
  });
}
