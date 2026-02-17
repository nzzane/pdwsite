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
  API_KEY: process.env.API_KEY || '',

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

  // Capcodes to exclude from sending (comma-separated, e.g. test pagers)
  EXCLUDE_CAPCODES: new Set(
    (process.env.EXCLUDE_CAPCODES || '1234567')
      .split(',')
      .map(s => s.trim().replace(/^0+(\d)/, '$1'))
      .filter(Boolean)
  ),
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
      const ts = new Date().toLocaleTimeString();
      if (res.statusCode === 200) {
        try {
          const result = JSON.parse(data);
          stats.sent += result.inserted;
          const capcodes = messages.map(m => m.capcode).join(', ');
          console.log(`[SENT] ${ts} ${messages.length} msg(s), ${result.inserted} inserted [${capcodes}]`);
          console.log(`[STATS] Total: recv=${stats.received} sent=${stats.sent} dedup=${stats.deduped} skip=${stats.excluded} err=${stats.errors}`);
        } catch (e) {
          console.log(`[SENT] ${ts} ${messages.length} msg(s) - response: ${data}`);
        }
      } else {
        stats.errors++;
        console.error(`[ERROR] ${ts} Server returned ${res.statusCode}: ${data}`);
      }
    });
  });

  req.on('error', (err) => {
    stats.errors++;
    const ts = new Date().toLocaleTimeString();
    console.error(`[ERROR] ${ts} Failed to send: ${err.message}`);
    // Re-queue on failure
    messageQueue.unshift(...messages);
  });

  req.write(body);
  req.end();
}

// ─── Statistics ───
let stats = { received: 0, sent: 0, deduped: 0, excluded: 0, errors: 0 };

// ─── Process a decoded line ───
async function processLine(line) {
  const parsed = parseLine(line);
  if (!parsed) {
    // Log unparsed lines that look like they might be pages (debug)
    if (line && line.trim() && (line.includes('FLEX') || line.includes('POCSAG'))) {
      console.log(`[PARSE] Could not parse: ${line.trim().substring(0, 120)}`);
    }
    return;
  }

  stats.received++;
  const ts = new Date().toLocaleTimeString();
  console.log(`[RECV] ${ts} ${parsed.protocol}/${parsed.bitrate || '?'} Cap:${parsed.capcode} ${parsed.content.substring(0, 100)}`);

  // Exclude test capcodes (still log them, just don't send)
  if (CONFIG.EXCLUDE_CAPCODES.has(parsed.capcode)) {
    stats.excluded++;
    console.log(`[SKIP] Test capcode ${parsed.capcode} excluded`);
    return;
  }

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

// ─── Start decoding ───
function start() {
  console.log('=== PDW Client ===');
  console.log(`Server: ${CONFIG.SERVER_URL}`);
  console.log(`Decoders: ${CONFIG.DECODERS.join(', ')}`);
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
