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

// ─── Configuration ───
const CONFIG = {
  SERVER_URL: process.env.SERVER_URL || 'http://localhost:3000',
  API_KEY: process.env.API_KEY || 'change-me-pdw-api-key',

  // RTL-SDR settings
  RTL_FREQUENCY: process.env.RTL_FREQUENCY || '157.925M',  // NZ pager frequency - adjust as needed
  RTL_GAIN: process.env.RTL_GAIN || '40',
  RTL_PPM: process.env.RTL_PPM || '0',
  RTL_DEVICE: process.env.RTL_DEVICE || '0',
  RTL_SAMPLE_RATE: process.env.RTL_SAMPLE_RATE || '22050',

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
};

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

  // POCSAG format
  const pocsagMatch = line.match(
    /^(POCSAG)(\d+):\s*Address:\s*(\d+)\s*Function:\s*(\d+)\s*(?:Alpha|Numeric|Tone):\s*(.*)/i
  );
  if (pocsagMatch) {
    const content = pocsagMatch[5].trim();
    if (!content) return null; // Skip empty messages
    return {
      protocol: 'POCSAG',
      bitrate: parseInt(pocsagMatch[2], 10),
      capcode: pocsagMatch[3],
      function_code: parseInt(pocsagMatch[4], 10),
      content,
      raw: line,
    };
  }

  // FLEX format (pipe-delimited)
  const flexMatch = line.match(
    /^FLEX[:|]\s*(.+?)\|(\d+)\|(\w+)\|([^|]+)\|(\d+)\|(.*)/i
  );
  if (flexMatch) {
    const content = flexMatch[6].trim();
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: parseInt(flexMatch[2], 10),
      capcode: flexMatch[5],
      function_code: 0,
      content,
      raw: line,
    };
  }

  // FLEX simpler format
  const flexSimple = line.match(/^FLEX:\s*.*?\|.*?\|(\d+)\|(.*)/i);
  if (flexSimple) {
    const content = flexSimple[2].trim();
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: null,
      capcode: flexSimple[1],
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

function queueMessage(msg) {
  messageQueue.push(msg);
  if (messageQueue.length >= CONFIG.BATCH_SIZE) {
    flushQueue();
  } else if (!sendTimer) {
    sendTimer = setTimeout(flushQueue, CONFIG.BATCH_INTERVAL_MS);
  }
}

function flushQueue() {
  if (sendTimer) {
    clearTimeout(sendTimer);
    sendTimer = null;
  }
  if (messageQueue.length === 0) return;

  const batch = messageQueue.splice(0);
  sendToServer(batch);
}

function sendToServer(messages) {
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
      if (res.statusCode === 200) {
        const result = JSON.parse(data);
        console.log(`[SENT] ${messages.length} messages, ${result.inserted} inserted`);
      } else {
        console.error(`[ERROR] Server returned ${res.statusCode}: ${data}`);
      }
    });
  });

  req.on('error', (err) => {
    console.error(`[ERROR] Failed to send: ${err.message}`);
    // Re-queue on failure
    messageQueue.unshift(...messages);
  });

  req.write(body);
  req.end();
}

// ─── Process a decoded line ───
async function processLine(line) {
  const parsed = parseLine(line);
  if (!parsed) return;

  console.log(`[RECV] ${parsed.protocol}${parsed.bitrate || ''} Cap:${parsed.capcode} ${parsed.content.substring(0, 80)}`);

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
    console.log(`[DEDUP] Skipping duplicate: ${parsed.capcode}`);
    return;
  }

  parsed.source = 'pdw-client';
  queueMessage(parsed);
}

// ─── Start decoding ───
function start() {
  console.log('=== PDW Client ===');
  console.log(`Server: ${CONFIG.SERVER_URL}`);
  console.log(`Decoders: ${CONFIG.DECODERS.join(', ')}`);

  if (CONFIG.READ_STDIN) {
    console.log('Reading from stdin (pipe multimon-ng output to this script)');
    startFromStdin();
  } else {
    console.log(`Frequency: ${CONFIG.RTL_FREQUENCY}`);
    console.log(`Gain: ${CONFIG.RTL_GAIN}, PPM: ${CONFIG.RTL_PPM}, Device: ${CONFIG.RTL_DEVICE}`);
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
}

function startRtlPipeline() {
  // Build rtl_fm command
  const rtlArgs = [
    '-f', CONFIG.RTL_FREQUENCY,
    '-g', CONFIG.RTL_GAIN,
    '-p', CONFIG.RTL_PPM,
    '-d', CONFIG.RTL_DEVICE,
    '-s', CONFIG.RTL_SAMPLE_RATE,
    '-', // output to stdout
  ];

  // Build multimon-ng command
  const multimonArgs = [
    '-t', 'raw',
    '-a', ...CONFIG.DECODERS.flatMap(d => ['-a', d]).slice(1), // First -a is already there
  ];
  // Fix: multimon-ng takes -a for each decoder
  const mmArgs = [];
  for (const d of CONFIG.DECODERS) {
    mmArgs.push('-a', d);
  }
  mmArgs.push('-t', 'raw', '-');

  console.log(`Starting: rtl_fm ${rtlArgs.join(' ')} | multimon-ng ${mmArgs.join(' ')}`);

  const rtl = spawn('rtl_fm', rtlArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  const multimon = spawn('multimon-ng', mmArgs, { stdio: [rtl.stdout, 'pipe', 'pipe'] });

  rtl.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[rtl_fm] ${msg}`);
  });

  multimon.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('Enabled decoders')) console.log(`[multimon-ng] ${msg}`);
  });

  let buffer = '';
  multimon.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      processLine(line);
    }
  });

  rtl.on('close', (code) => {
    console.log(`rtl_fm exited with code ${code}`);
    if (code !== 0) {
      console.log('Restarting in 5 seconds...');
      setTimeout(startRtlPipeline, 5000);
    }
  });

  multimon.on('close', (code) => {
    console.log(`multimon-ng exited with code ${code}`);
  });

  // Handle process signals
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    flushQueue();
    rtl.kill();
    multimon.kill();
    setTimeout(() => process.exit(0), 1000);
  });
}

start();
