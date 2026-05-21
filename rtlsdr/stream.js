'use strict';

/**
 * RTL-SDR FireComm audio streaming server.
 * Runs rtl_fm | ffmpeg to demodulate FM audio from a configured frequency,
 * encodes to MP3, and fans out to multiple HTTP clients.
 *
 * Endpoints:
 *   GET  /stream       - Audio stream (MP3/ICY)
 *   GET  /status       - JSON health/status
 *   POST /control      - Update freq/gain/squelch/mode (restarts pipeline)
 *   POST /auto-squelch - Measure noise floor, return suggested squelch value
 */

const http = require('http');
const { spawn } = require('child_process');

// ─── Config (from env, overridable at runtime via /control) ───
let currentFreq     = process.env.FREQ        || '75.5875M';
let currentMode     = process.env.MODE        || 'fm';
let currentGain     = process.env.GAIN        || '40';
let currentSquelch  = parseInt(process.env.SQUELCH || '0', 10);
const SAMPLE_RATE   = process.env.SAMPLE_RATE || '200000';
const PORT          = parseInt(process.env.STREAM_PORT || '8090', 10);

// ─── State ───
const clients  = new Set();   // active HTTP response objects
let rtlProc    = null;
let ffmpegProc = null;
let isRunning  = false;
let streamStart = null;
let restartTimer = null;
let autoSquelching = false;

// ─── Pipeline management ───

function buildRtlArgs() {
  return [
    '-f', currentFreq,
    '-M', currentMode,
    '-s', SAMPLE_RATE,
    '-g', currentGain.toString(),
    '-l', currentSquelch.toString(),
    '-r', '48000',
    '-',
  ];
}

const FFMPEG_ARGS = [
  '-hide_banner', '-loglevel', 'error',
  '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', 'pipe:0',
  '-codec:a', 'libmp3lame', '-b:a', '64k',
  '-f', 'mp3', 'pipe:1',
];

function stopPipeline() {
  isRunning = false;
  if (ffmpegProc) {
    try { ffmpegProc.stdin.destroy(); } catch {}
    try { ffmpegProc.kill('SIGTERM'); } catch {}
    ffmpegProc = null;
  }
  if (rtlProc) {
    try { rtlProc.kill('SIGTERM'); } catch {}
    rtlProc = null;
  }
}

function startPipeline() {
  if (autoSquelching) return; // let auto-squelch finish first
  stopPipeline();

  console.log(`[rtlsdr] Starting: ${currentFreq} ${currentMode.toUpperCase()} gain=${currentGain} squelch=${currentSquelch}`);

  rtlProc    = spawn('rtl_fm',  buildRtlArgs(),  { stdio: ['ignore', 'pipe', 'pipe'] });
  ffmpegProc = spawn('ffmpeg',  FFMPEG_ARGS,     { stdio: ['pipe',   'pipe', 'pipe'] });

  rtlProc.stdout.pipe(ffmpegProc.stdin);

  // Fan out encoded MP3 chunks to all connected clients
  ffmpegProc.stdout.on('data', (chunk) => {
    for (const res of clients) {
      try {
        if (!res.destroyed && !res.writableEnded) {
          res.write(chunk);
        } else {
          clients.delete(res);
        }
      } catch {
        clients.delete(res);
      }
    }
  });

  rtlProc.stderr.on('data',    (d) => process.stderr.write('[rtl_fm] ' + d));
  ffmpegProc.stderr.on('data', (d) => process.stderr.write('[ffmpeg] ' + d));

  isRunning  = true;
  streamStart = Date.now();

  function scheduleRestart(label, code) {
    if (!isRunning) return;
    console.log(`[rtlsdr] ${label} exited (${code}), restarting in 5s…`);
    stopPipeline();
    clearTimeout(restartTimer);
    restartTimer = setTimeout(startPipeline, 5000);
  }

  rtlProc.on('error',    (e) => scheduleRestart('rtl_fm (spawn error: ' + e.message + ')', -1));
  rtlProc.on('close',    (c) => scheduleRestart('rtl_fm', c ?? 0));
  ffmpegProc.on('error', (e) => scheduleRestart('ffmpeg (spawn error: ' + e.message + ')', -1));
  ffmpegProc.on('close', (c) => scheduleRestart('ffmpeg', c ?? 0));
}

// ─── Auto-squelch: sample raw PCM noise floor for 2.5 seconds ───

function measureNoiseFloor() {
  return new Promise((resolve, reject) => {
    const TARGET_BYTES = 48000 * 2 * 2.5; // 2.5 seconds of s16le @48kHz mono
    const chunks = [];
    let totalBytes = 0;
    let done = false;

    const proc = spawn('rtl_fm', [
      '-f', currentFreq, '-M', currentMode, '-s', SAMPLE_RATE,
      '-g', currentGain.toString(), '-l', '0', '-r', '48000', '-',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const finish = () => {
      if (done) return;
      done = true;
      try { proc.kill('SIGTERM'); } catch {}

      const buf = Buffer.concat(chunks, totalBytes);
      if (buf.length < 2) { reject(new Error('Insufficient data from rtl_fm')); return; }

      // Calculate RMS of 16-bit signed PCM samples
      let sumSq = 0;
      const n = Math.floor(buf.length / 2);
      for (let i = 0; i < n * 2; i += 2) {
        const s = buf.readInt16LE(i);
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / n);
      // rtl_fm squelch uses values in roughly the same scale as the normalised signal
      // A multiple of ~1.4 gives headroom above noise floor
      const suggested = Math.min(50, Math.round((rms / 327.67) * 1.4));
      resolve({ rms: Math.round(rms), normalised: Math.round(rms / 327.67), suggested });
    };

    proc.stdout.on('data', (chunk) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
      if (totalBytes >= TARGET_BYTES) finish();
    });

    proc.on('error',  (e) => { if (!done) { done = true; reject(e); } });
    proc.on('close',  ()  => finish());

    // Safety timeout
    setTimeout(() => {
      if (!done) { done = true; try { proc.kill('SIGTERM'); } catch {} finish(); }
    }, 8000);
  });
}

// ─── HTTP Server ───

const server = http.createServer((req, res) => {
  // Allow PDW server (same internal network) to proxy requests
  res.setHeader('Cache-Control', 'no-cache, no-store');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /stream — MP3 audio stream
  if (req.method === 'GET' && req.url === '/stream') {
    res.writeHead(200, {
      'Content-Type':      'audio/mpeg',
      'Connection':        'keep-alive',
      'Transfer-Encoding': 'chunked',
      'icy-name':          `FireComm ${currentFreq}`,
      'icy-genre':         'Fire/Emergency',
      'icy-br':            '64',
    });
    clients.add(res);
    const remove = () => {
      clients.delete(res);
      console.log(`[rtlsdr] Client left (${clients.size} active)`);
    };
    req.on('close', remove);
    req.on('error', remove);
    console.log(`[rtlsdr] Client connected (${clients.size} active)`);
    return;
  }

  // GET /status — JSON health
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      running:   isRunning,
      freq:      currentFreq,
      mode:      currentMode,
      gain:      currentGain,
      squelch:   currentSquelch,
      clients:   clients.size,
      uptime_s:  streamStart ? Math.floor((Date.now() - streamStart) / 1000) : 0,
    }));
    return;
  }

  // POST /control — update parameters and restart
  if (req.method === 'POST' && req.url === '/control') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        let changed = false;
        if (p.freq   !== undefined && String(p.freq)   !== currentFreq)                  { currentFreq   = String(p.freq);              changed = true; }
        if (p.gain   !== undefined && String(p.gain)   !== String(currentGain))           { currentGain   = String(p.gain);              changed = true; }
        if (p.squelch !== undefined && parseInt(p.squelch, 10) !== currentSquelch)        { currentSquelch = parseInt(p.squelch, 10);    changed = true; }
        if (p.mode   !== undefined && p.mode           !== currentMode)                   { currentMode   = p.mode;                      changed = true; }
        if (changed) {
          clearTimeout(restartTimer);
          startPipeline();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, changed, freq: currentFreq, gain: currentGain, squelch: currentSquelch, mode: currentMode }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON: ' + e.message }));
      }
    });
    return;
  }

  // POST /auto-squelch — measure noise floor, apply suggested squelch
  if (req.method === 'POST' && req.url === '/auto-squelch') {
    if (autoSquelching) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Auto-squelch measurement already running' }));
      return;
    }
    autoSquelching = true;
    stopPipeline();
    // Wait for the OS to fully release the USB device before opening it again.
    // usb_claim_interface error -6 occurs when the previous rtl_fm process
    // hasn't fully exited yet. 1.5 s is enough on all tested hardware.
    setTimeout(() => {
      measureNoiseFloor()
        .then((result) => {
          currentSquelch = result.suggested;
          autoSquelching = false;
          startPipeline();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...result, squelch: currentSquelch }));
        })
        .catch((err) => {
          autoSquelching = false;
          startPipeline();
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
    }, 1500);
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[rtlsdr] Stream server on :${PORT}  freq=${currentFreq} mode=${currentMode} gain=${currentGain} squelch=${currentSquelch}`);
  startPipeline();
});

// ─── Graceful shutdown ───
function shutdown() {
  console.log('[rtlsdr] Shutting down…');
  clearTimeout(restartTimer);
  stopPipeline();
  // End all client streams cleanly
  for (const res of clients) { try { res.end(); } catch {} }
  clients.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
