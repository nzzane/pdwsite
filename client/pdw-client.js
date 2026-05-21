#!/usr/bin/env node
/**
 * PDW Client Script
 *
 * Runs on the Linux machine with the RTL-SDR dongle.
 * Spawns rtl_fm piped to multimon-ng, parses the output,
 * joins multipart messages, deduplicates, and sends to the server API.
 *
 * Usage:
 *   API_KEY=your-key SERVER_URL=http://yourserver:3000 node pdw-client.js
 *
 * Or configure via env vars or the config below.
 *
 * Requirements:
 *   - rtl_fm (from rtl-sdr package)
 *   - multimon-ng
 */

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

// ─── Configuration ───
const CONFIG = {
  SERVER_URL: process.env.SERVER_URL || 'http://localhost:3000',
  API_KEY: process.env.API_KEY || '',

  // RTL-SDR settings - tuned for city suburb / modern townhouse
  RTL_FREQUENCY: process.env.RTL_FREQUENCY || '157.950M',
  RTL_GAIN: process.env.RTL_GAIN || '32',
  RTL_PPM: process.env.RTL_PPM || '0',
  RTL_DEVICE: process.env.RTL_DEVICE || '0',
  RTL_SAMPLE_RATE: process.env.RTL_SAMPLE_RATE || '22050',
  RTL_SQUELCH: process.env.RTL_SQUELCH || '0',

  // Multimon-ng decoders
  DECODERS: (process.env.DECODERS || 'POCSAG512,POCSAG1200,FLEX').split(',').map(d => d.trim()),

  // Batching: send messages in batches for efficiency
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE || '10', 10),
  BATCH_INTERVAL_MS: parseInt(process.env.BATCH_INTERVAL_MS || '2000', 10),

  // Dedup window (seconds)
  DEDUP_WINDOW_S: parseInt(process.env.DEDUP_WINDOW_S || '30', 10),

  // Multipart join timeout (ms)
  MULTIPART_TIMEOUT_MS: parseInt(process.env.MULTIPART_TIMEOUT_MS || '10000', 10),

  // If true, read from stdin instead of spawning rtl_fm (for testing / piping)
  READ_STDIN: process.env.READ_STDIN === '1' || process.env.READ_STDIN === 'true',

  // Capcodes to exclude from sending (comma-separated, empty = none excluded)
  EXCLUDE_CAPCODES: new Set(
    (process.env.EXCLUDE_CAPCODES || '')
      .split(',')
      .map(s => s.trim().replace(/^0+(\d)/, '$1'))
      .filter(Boolean)
  ),

  // Retry settings for HTTP send failures
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '5', 10),
  RETRY_BASE_MS: parseInt(process.env.RETRY_BASE_MS || '2000', 10),

  // Queue limits to prevent memory exhaustion
  MAX_QUEUE_SIZE: parseInt(process.env.MAX_QUEUE_SIZE || '1000', 10),

  // Pipeline restart delay (ms)
  PIPELINE_RESTART_DELAY_MS: parseInt(process.env.PIPELINE_RESTART_DELAY_MS || '5000', 10),

  // Health check file path - updated on each successful decode
  HEALTH_FILE: process.env.PDW_HEALTH_FILE || '/tmp/.pdw-last-message',

  // FLEX fragment join timeout (ms) — hold FLEX messages by capcode
  // to join fragments that multimon-ng splits across output lines
  FLEX_JOIN_MS: parseInt(process.env.FLEX_JOIN_MS || '2000', 10),

  // Silence alert: warn if no messages received for this many minutes (0 = disabled)
  SILENCE_ALERT_MIN: parseInt(process.env.SILENCE_ALERT_MIN || '0', 10),

  // Debug mode - enables verbose logging
  DEBUG: process.env.DEBUG === '1' || process.env.DEBUG === 'true',
};

// ─── Content cleaning ───
// Strips multimon-ng control character tags and fixes character mappings
function cleanContent(content) {
  if (!content) return '';
  return content
    .replace(/<[A-Za-z]{2,4}>/g, '')  // Strip <ETX>, <EOT>, <STX>, <NUL>, etc.
    .replace(/Ä/g, '[')               // Multimon-ng maps [ to Ä
    .replace(/Ü/g, ']')               // Multimon-ng maps ] to Ü
    .trim();
}

// ─── Dedup tracking ───
const recentHashes = new Map();

function dedupeHash(capcode, content) {
  return crypto.createHash('sha256')
    .update(`${capcode}:${(content || '').trim().toLowerCase()}`)
    .digest('hex')
    .substring(0, 16);
}

function isDuplicate(hash) {
  const now = Date.now();
  // Clean old entries
  for (const [h, ts] of recentHashes) {
    if (now - ts > CONFIG.DEDUP_WINDOW_S * 1000) recentHashes.delete(h);
  }
  if (recentHashes.has(hash)) return true;
  recentHashes.set(hash, now);
  return false;
}

// ─── Multipart buffer ───
const multipartBuffer = new Map();

// ─── FLEX fragment join buffer ───
// Holds the full parsed message per capcode. If a second fragment arrives
// within FLEX_JOIN_MS with overlapping content, they are joined. Otherwise
// the held message is flushed as-is when the timer fires.
const flexFragments = new Map();

function joinOverlap(existing, incoming) {
  const minOverlap = 4;
  const maxCheck = Math.min(existing.length, incoming.length, 40);
  for (let len = maxCheck; len >= minOverlap; len--) {
    if (existing.slice(-len) === incoming.slice(0, len)) {
      return existing + incoming.slice(len);
    }
  }
  return null;
}

// Called from processLine with the full parsed message.
// Returns true if the message was held (don't process further).
// Returns false if the message should continue through the pipeline.
function bufferFlexFragment(parsed) {
  if (CONFIG.FLEX_JOIN_MS <= 0) return false;

  const key = String(parsed.capcode);
  const existing = flexFragments.get(key);

  if (!existing) {
    // First fragment — hold it with a flush timer
    const entry = {
      parsed,
      timer: setTimeout(() => {
        flexFragments.delete(key);
        // Flush the held message through the rest of the pipeline
        finishProcessLine(existing.parsed);
      }, CONFIG.FLEX_JOIN_MS),
    };
    flexFragments.set(key, entry);
    return true; // held
  }

  // Subsequent fragment — cancel timer, delete entry
  clearTimeout(existing.timer);
  flexFragments.delete(key);

  // Try overlap join
  const joined = joinOverlap(existing.parsed.content, parsed.content);
  if (joined) {
    existing.parsed.content = joined;
    existing.parsed.is_multipart = true;
    finishProcessLine(existing.parsed);
    return true; // consumed (joined into held)
  }

  // No overlap — let the new one through, discard the held one
  return false;
}

function flushAllHeldFragments() {
  for (const [key, entry] of flexFragments) {
    clearTimeout(entry.timer);
    flexFragments.delete(key);
    finishProcessLine(entry.parsed);
  }
}

function flushFlexFragment(capcode) {
  const key = String(capcode);
  const entry = flexFragments.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    flexFragments.delete(key);
    return entry.content;
  }
  return null;
}

function parseMultipart(content) {
  if (!content) return null;
  const patterns = [
    /\(?\s*(\d+)\s*(?:\/|of)\s*(\d+)\s*\)?/i,
    /\bPART\s*(\d+)\s*(?:\/|of)\s*(\d+)/i,
    /\[(\d+)\/(\d+)\]/i,
  ];
  for (const p of patterns) {
    const m = content.match(p);
    if (m) {
      const part = parseInt(m[1], 10);
      const total = parseInt(m[2], 10);
      if (part > 0 && total > 1 && part <= total) {
        const cleaned = content.replace(m[0], '').trim();
        return { part, total, cleaned };
      }
    }
  }
  return null;
}

function handleMultipart(capcode, content) {
  const mp = parseMultipart(content);
  if (!mp) return content; // Not multipart, return as-is

  const key = capcode;
  let entry = multipartBuffer.get(key);

  if (!entry || entry.total !== mp.total) {
    entry = {
      parts: new Array(mp.total).fill(null),
      total: mp.total,
      timer: null,
    };
    multipartBuffer.set(key, entry);
  }

  entry.parts[mp.part - 1] = mp.cleaned;

  if (entry.timer) clearTimeout(entry.timer);

  const received = entry.parts.filter(p => p !== null).length;
  if (received === entry.total) {
    multipartBuffer.delete(key);
    return entry.parts.join(' ');
  }

  // Set timeout to flush partial
  return new Promise((resolve) => {
    entry.timer = setTimeout(() => {
      const partial = entry.parts.filter(p => p !== null).join(' ');
      multipartBuffer.delete(key);
      resolve(partial);
    }, CONFIG.MULTIPART_TIMEOUT_MS);

    // If all parts received while waiting
    entry.resolve = resolve;
  });
}

// ─── Line parser ───
function parseLine(line) {
  if (!line || typeof line !== 'string') return null;
  line = line.trim();
  if (!line) return null;

  // Strip syslog/timestamp prefix if present
  // e.g., "Dec 31 23:47:50 host ... [quality...] FLEX|..."
  const protoMatch = line.match(/(FLEX[|:]|POCSAG\d*:)/i);
  if (protoMatch && protoMatch.index > 0) {
    line = line.substring(protoMatch.index);
  }

  // POCSAG format
  // POCSAG512: Address: 1125635 Function: 3 Alpha: MATAFRU RED 1 ...
  const pocsagMatch = line.match(
    /^(POCSAG)(\d+):\s*Address:\s*(\d+)\s*Function:\s*(\d+)\s*(?:Alpha|Numeric|Tone):\s*(.*)/i
  );
  if (pocsagMatch) {
    const content = cleanContent(pocsagMatch[5]);
    if (!content) return null;
    return {
      protocol: 'POCSAG',
      bitrate: parseInt(pocsagMatch[2], 10),
      capcode: pocsagMatch[3],
      function_code: parseInt(pocsagMatch[4], 10),
      content,
      raw: line,
    };
  }

  // POCSAG tone-only (no Alpha/Numeric/Tone content section)
  // POCSAG1200: Address:  586505  Function: 0
  const pocsagTone = line.match(
    /^(POCSAG)(\d+):\s*Address:\s*(\d+)\s*Function:\s*(\d+)\s*$/i
  );
  if (pocsagTone) {
    return {
      protocol: 'POCSAG',
      bitrate: parseInt(pocsagTone[2], 10),
      capcode: pocsagTone[3],
      function_code: parseInt(pocsagTone[4], 10),
      content: '[Tone]',
      raw: line,
    };
  }

  // FLEX format: 7-field pipe-delimited (standard multimon-ng FLEX output)
  // FLEX|2026-02-17 17:52:07|1600/2/K/A|13.013|001234567|ALN|Message text
  const flex7 = line.match(
    /^FLEX\|([^|]+)\|(\d+)\/[^|]*\|[^|]+\|(\d+)\|(\w+)\|(.*)/i
  );
  if (flex7) {
    const content = cleanContent(flex7[5]);
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: parseInt(flex7[2], 10),
      capcode: flex7[3].replace(/^0+(\d)/, '$1'),
      function_code: 0,
      content,
      raw: line,
    };
  }

  // FLEX format: bracket style
  // FLEX: 2025-02-17 12:34:56 1600/2/K/A 07.041 [0001234567] ALN Message text
  const flexBracket = line.match(
    /^FLEX[:|]\s*(?:[\d-]+\s+[\d:]+\s+)?(\d+)\/\d+\/\w\/.\s+[\d.]+\s+\[(\d+)\]\s+(\w{3})\s+(.*)/i
  );
  if (flexBracket) {
    const content = cleanContent(flexBracket[4]);
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: parseInt(flexBracket[1], 10),
      capcode: flexBracket[2].replace(/^0+(\d)/, '$1'),
      function_code: 0,
      content,
      raw: line,
    };
  }

  // FLEX format: 6-field pipe-delimited (alternative tools)
  // FLEX|timestamp|1600|ALN|07.041|1234567|Message text
  const flex6 = line.match(
    /^FLEX[:|]\s*([^|]+)\|(\d+)\|(\w+)\|([^|]+)\|(\d+)\|(.*)/i
  );
  if (flex6) {
    const content = cleanContent(flex6[6]);
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: parseInt(flex6[2], 10),
      capcode: flex6[5].replace(/^0+(\d)/, '$1'),
      function_code: 0,
      content,
      raw: line,
    };
  }

  // FLEX simpler fallback
  const flexSimple = line.match(/^FLEX[:|]\s*.*?\|.*?\|(\d+)\|(.*)/i);
  if (flexSimple) {
    const content = cleanContent(flexSimple[2]);
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: null,
      capcode: flexSimple[1].replace(/^0+(\d)/, '$1'),
      function_code: 0,
      content,
      raw: line,
    };
  }

  return null;
}

// ─── Message queue & sending ───
let messageQueue = [];
let sendTimer = null;
let sendRetryCount = 0;
let isSending = false;

function queueMessage(msg) {
  // Enforce queue size limit to prevent memory exhaustion
  if (messageQueue.length >= CONFIG.MAX_QUEUE_SIZE) {
    console.log(`[QUEUE] Queue full (${CONFIG.MAX_QUEUE_SIZE}), dropping oldest message`);
    messageQueue.shift();
    stats.dropped++;
  }
  messageQueue.push(msg);
  if (messageQueue.length >= CONFIG.BATCH_SIZE && !isSending) {
    flushQueue();
  } else if (!sendTimer && !isSending) {
    sendTimer = setTimeout(flushQueue, CONFIG.BATCH_INTERVAL_MS);
  }
}

function flushQueue() {
  if (sendTimer) {
    clearTimeout(sendTimer);
    sendTimer = null;
  }
  if (messageQueue.length === 0 || isSending) return;

  const batch = messageQueue.splice(0);
  sendToServer(batch);
}

function calculateRetryDelay(attempt) {
  // Exponential backoff: 2s, 4s, 8s, 16s, 32s (capped at 60s)
  const delay = Math.min(CONFIG.RETRY_BASE_MS * Math.pow(2, attempt), 60000);
  // Add jitter to prevent thundering herd (+/- 20%)
  const jitter = delay * 0.2 * (Math.random() - 0.5) * 2;
  return Math.max(1000, delay + jitter);
}

function sendToServer(messages, attempt = 0) {
  if (attempt > 0) {
    isSending = true;
  }
  
  const body = JSON.stringify(messages);
  const url = new URL('/api/ingest', CONFIG.SERVER_URL);
  const mod = url.protocol === 'https:' ? https : http;

  const req = mod.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': CONFIG.API_KEY,
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: 10000,
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      isSending = false;
      sendRetryCount = 0; // Reset on success
      const ts = new Date().toLocaleTimeString();
      if (res.statusCode === 200) {
        try {
          const result = JSON.parse(data);
          stats.sent += result.inserted;
          const capcodes = messages.map(m => m.capcode).join(', ');
          console.log(`[SENT] ${ts} ${messages.length} msg(s), ${result.inserted} inserted [${capcodes}]`);
          console.log(`[STATS] Total: recv=${stats.received} sent=${stats.sent} dedup=${stats.deduped} skip=${stats.excluded} err=${stats.errors} dropped=${stats.dropped}`);
        } catch (e) {
          console.log(`[SENT] ${ts} ${messages.length} msg(s) - response: ${data}`);
        }
        // Try to send next batch if queued
        if (messageQueue.length > 0) {
          setTimeout(flushQueue, 100);
        }
      } else {
        // Server error - retry with backoff
        stats.errors++;
        console.error(`[ERROR] ${ts} Server returned ${res.statusCode}: ${data}`);
        handleSendFailure(messages, attempt);
      }
    });
  });

  req.on('error', (err) => {
    isSending = false;
    stats.errors++;
    const ts = new Date().toLocaleTimeString();
    console.error(`[ERROR] ${ts} Failed to send: ${err.message}`);
    handleSendFailure(messages, attempt);
  });

  req.on('timeout', () => {
    isSending = false;
    req.destroy();
    stats.errors++;
    const ts = new Date().toLocaleTimeString();
    console.error(`[ERROR] ${ts} Request timed out after 10s`);
    handleSendFailure(messages, attempt);
  });

  req.write(body);
  req.end();
}

function handleSendFailure(messages, attempt) {
  sendRetryCount++;
  
  if (sendRetryCount >= CONFIG.MAX_RETRIES) {
    console.error(`[ERROR] Max retries (${CONFIG.MAX_RETRIES}) exceeded, dropping ${messages.length} message(s)`);
    stats.dropped += messages.length;
    if (messageQueue.length > 0) {
      setTimeout(flushQueue, CONFIG.RETRY_BASE_MS * 2);
    }
    sendRetryCount = 0;
    return;
  }

  const delay = calculateRetryDelay(attempt);
  console.log(`[RETRY] Retrying in ${Math.round(delay / 1000)}s (attempt ${sendRetryCount}/${CONFIG.MAX_RETRIES})`);
  
  setTimeout(() => {
    messageQueue.unshift(...messages);
    if (!isSending) {
      flushQueue();
    }
  }, delay);
}

// Fire-and-forget silence alert to server — tells server that this client
// hasn't seen any pager messages for a while. Server relays to admin users.
let lastSilenceAlertSent = 0;
function sendSilenceAlert(minutes) {
  // Only alert once per silence period (avoid spam)
  if (Date.now() - lastSilenceAlertSent < minutes * 60000) return;
  lastSilenceAlertSent = Date.now();

  const url = new URL('/api/client/silence-alert', CONFIG.SERVER_URL);
  const mod = url.protocol === 'https:' ? https : http;
  const body = JSON.stringify({ minutes, source: 'pdw-client' });

  const req = mod.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': CONFIG.API_KEY,
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: 5000,
  });
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.write(body);
  req.end();
}

// ─── Health tracking ───
let lastMessageTime = 0;

function updateHealth() {
  lastMessageTime = Date.now();
  try {
    fs.writeFileSync(CONFIG.HEALTH_FILE, String(Math.floor(Date.now() / 1000)), { mode: 0o644 });
  } catch (err) {
    // Ignore if health file can't be written (e.g., read-only filesystem)
  }
}

// ─── Statistics ───
let stats = { received: 0, sent: 0, deduped: 0, excluded: 0, errors: 0, dropped: 0 };

// ─── Process a decoded line ───
async function processLine(line) {
  if (CONFIG.DEBUG && line.trim()) {
    logDebug(`processLine input: "${line.substring(0, 200)}"`);
  }

  const parsed = parseLine(line);
  if (!parsed) {
    // Log unparsed lines that look like they might be pages (debug)
    if (line && line.trim() && (line.includes('FLEX') || line.includes('POCSAG'))) {
      console.log(`[PARSE] Could not parse: ${line.trim().substring(0, 120)}`);
    }
    return;
  }

  stats.received++;
  updateHealth();
  
  const ts = new Date().toLocaleTimeString();
  console.log(`[RECV] ${ts} ${parsed.protocol}/${parsed.bitrate || '?'} Cap:${parsed.capcode} ${parsed.content.substring(0, 100)}`);

  // Exclude configured capcodes (still log them and update health, just don't send)
  if (CONFIG.EXCLUDE_CAPCODES.has(parsed.capcode)) {
    stats.excluded++;
    console.log(`[EXCLUDE] ${ts} Cap:${parsed.capcode} excluded from sending (still logged)`);
    return;
  }

  // FLEX fragment join: hold first fragment, join with next if overlap detected
  if (parsed.protocol === 'FLEX') {
    if (bufferFlexFragment(parsed)) return; // held or consumed
  }

  // Continue through multipart, dedup, queue
  finishProcessLine(parsed);
}

// Second half of processLine — multipart, dedup, queue.
// Called directly or from the FLEX fragment flush timer.
async function finishProcessLine(parsed) {
  const ts = new Date().toLocaleTimeString();

  // Handle multipart
  const result = handleMultipart(parsed.capcode, parsed.content);
  let finalContent;
  if (result instanceof Promise) {
    finalContent = await result;
    parsed.is_multipart = true;
  } else if (result !== parsed.content) {
    finalContent = result;
    parsed.is_multipart = true;
  } else {
    finalContent = parsed.content;
  }

  parsed.content = finalContent;

  // Dedup
  const hash = dedupeHash(parsed.capcode, parsed.content);
  if (isDuplicate(hash)) {
    stats.deduped++;
    console.log(`[DEDUP] Skipping duplicate: Cap:${parsed.capcode}`);
    return;
  }

  parsed.source = 'pdw-client';
  queueMessage(parsed);
}

// ─── Pipeline management ───
let rtl = null;
let multimon = null;
let isShuttingDown = false;
let restartTimer = null;
let statsTimer = null;
let lastDataTime = 0;
let bytesReceived = 0;
let linesReceived = 0;

function logDebug(msg) {
  if (CONFIG.DEBUG) console.log(`[DEBUG] ${msg}`);
}

function killPipeline() {
  if (rtl) {
    try { rtl.kill('SIGTERM'); } catch {}
    rtl = null;
  }
  if (multimon) {
    try { multimon.kill('SIGTERM'); } catch {}
    multimon = null;
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

function startRtlPipeline() {
  if (isShuttingDown) return;

  // Build rtl_fm command - includes DC offset removal, no high-pass filter, and fast atan
  const rtlArgs = [
    '-f', CONFIG.RTL_FREQUENCY,
    '-g', CONFIG.RTL_GAIN,
    '-p', CONFIG.RTL_PPM,
    '-d', CONFIG.RTL_DEVICE,
    '-s', CONFIG.RTL_SAMPLE_RATE,
    '-E', 'dc',  // Remove DC spike
    '-F', '0',   // Disable high-pass filter (better for pager signals)
    '-A', 'fast', // Fast atan math (lower CPU)
  ];

  // Add squelch if non-zero
  const squelch = parseInt(CONFIG.RTL_SQUELCH, 10);
  if (squelch > 0) {
    rtlArgs.push('-l', String(squelch));
  }

  rtlArgs.push('-'); // output to stdout

  // Build multimon-ng command
  const mmArgs = [];
  for (const d of CONFIG.DECODERS) {
    mmArgs.push('-a', d);
  }
  mmArgs.push('-t', 'raw', '-');

  console.log(`Starting: rtl_fm ${rtlArgs.join(' ')} | multimon-ng ${mmArgs.join(' ')}`);

  rtl = spawn('rtl_fm', rtlArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  multimon = spawn('multimon-ng', mmArgs, { stdio: [rtl.stdout, 'pipe', 'pipe'] });

  rtl.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) {
      if (CONFIG.DEBUG) {
        console.log(`[rtl_fm] ${msg}`);
      } else if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('no supported')) {
        console.error(`[rtl_fm ERROR] ${msg}`);
      }
    }
  });

  multimon.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) {
      if (CONFIG.DEBUG) {
        console.log(`[multimon-ng] ${msg}`);
      } else if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fail')) {
        console.error(`[multimon-ng ERROR] ${msg}`);
      }
    }
  });

  let buffer = '';
  let chunkCount = 0;
  multimon.stdout.on('data', (chunk) => {
    chunkCount++;
    bytesReceived += chunk.length;
    lastDataTime = Date.now();

    if (CONFIG.DEBUG && chunkCount <= 20) {
      logDebug(`multimon-ng chunk #${chunkCount}: ${chunk.length} bytes, raw: ${JSON.stringify(chunk.toString().substring(0, 200))}`);
    }

    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      linesReceived++;
      if (CONFIG.DEBUG) {
        logDebug(`multimon-ng stdout line #${linesReceived}: "${line}"`);
      }
      processLine(line);
    }
  });

  // Periodic stats dump (every 30s) — always enabled for monitoring
  statsTimer = setInterval(() => {
    const now = Date.now();
    const sinceLastData = lastDataTime ? Math.round((now - lastDataTime) / 1000) : 'never';
    console.log(`[STATS] ${stats.received} msgs decoded, ${bytesReceived} bytes raw, ${linesReceived} lines, last_data=${sinceLastData}s ago, queue=${messageQueue.length}`);

    // Flush any held FLEX fragments that haven't been joined
    flushAllHeldFragments();

    // Silence alert: warn and notify server if no messages received for configured threshold
    if (CONFIG.SILENCE_ALERT_MIN > 0 && lastDataTime) {
      const silenceMins = Math.round((now - lastDataTime) / 60000);
      if (silenceMins >= CONFIG.SILENCE_ALERT_MIN) {
        console.error(`[SILENCE] No pager messages for ${silenceMins} minutes. Check RTL-SDR connection, antenna, and frequency.`);
        // Send silence alert to server (one-way fire-and-forget, don't block)
        sendSilenceAlert(silenceMins);
      }
    }

    // Silence alert: no data from multimon-ng for 60+ seconds
    if (lastDataTime && (now - lastDataTime) > 60000) {
      console.error(`[WARNING] No data received from multimon-ng for 60+ seconds. Check RTL-SDR connection, antenna, and frequency.`);
    }
  }, 30000);

  // Handle rtl_fm exit - restart the entire pipeline
  rtl.on('close', (code) => {
    if (isShuttingDown) return;
    console.log(`[PIPELINE] rtl_fm exited with code ${code}`);
    console.log(`[PIPELINE] Restarting in ${CONFIG.PIPELINE_RESTART_DELAY_MS / 1000}s...`);
    killPipeline();
    restartTimer = setTimeout(startRtlPipeline, CONFIG.PIPELINE_RESTART_DELAY_MS);
  });

  // Handle multimon-ng exit - restart the entire pipeline
  // This is critical: if multimon-ng dies, we lose all decoding even if rtl_fm is running
  multimon.on('close', (code) => {
    if (isShuttingDown) return;
    console.log(`[PIPELINE] multimon-ng exited with code ${code}`);
    console.log(`[PIPELINE] Restarting pipeline in ${CONFIG.PIPELINE_RESTART_DELAY_MS / 1000}s...`);
    killPipeline();
    restartTimer = setTimeout(startRtlPipeline, CONFIG.PIPELINE_RESTART_DELAY_MS);
  });

  // Handle process signals (tini forwards these properly)
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n[SHUTDOWN] ${signal} received. Flushing queue and shutting down...`);

  // Stop periodic stats
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
  
  // Flush any remaining messages
  flushQueue();
  
  // Give time for final sends
  setTimeout(() => {
    killPipeline();
    console.log('[SHUTDOWN] Pipeline terminated.');
    process.exit(0);
  }, 2000);
}

// ─── Start decoding ───
function start() {
  console.log('=== PDW Client ===');
  console.log(`Server: ${CONFIG.SERVER_URL}`);
  console.log(`Decoders: ${CONFIG.DECODERS.join(', ')}`);
  console.log(`Gain: ${CONFIG.RTL_GAIN}, PPM: ${CONFIG.RTL_PPM}, Device: ${CONFIG.RTL_DEVICE}`);
  console.log(`Frequency: ${CONFIG.RTL_FREQUENCY}`);
  console.log(`Max queue size: ${CONFIG.MAX_QUEUE_SIZE}`);
  console.log(`Max send retries: ${CONFIG.MAX_RETRIES}`);
  console.log(`Debug mode: ${CONFIG.DEBUG ? 'ON' : 'OFF'}`);
  if (CONFIG.EXCLUDE_CAPCODES.size > 0) {
    console.log(`Excluded capcodes: ${[...CONFIG.EXCLUDE_CAPCODES].join(', ')}`);
  }

  if (!CONFIG.API_KEY) {
    console.error('ERROR: API_KEY is not set.');
    console.error('Get it from: Admin Panel > Settings, or: docker exec pdw-monitor cat /data/.api-key');
    process.exit(1);
  }

  if (CONFIG.READ_STDIN) {
    console.log('Reading from stdin (pipe multimon-ng output to this script)');
    startFromStdin();
  } else {
    console.log(`Starting RTL-SDR pipeline...`);
    startRtlPipeline();
  }
}

function startFromStdin() {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line
    for (const line of lines) {
      processLine(line);
    }
  });
  process.stdin.on('end', () => {
    if (buffer.trim()) processLine(buffer);
    flushQueue();
    console.log('stdin ended');
  });

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

start();
