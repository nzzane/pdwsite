const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { router, setBroadcast } = require('./routes');

// ─── Uncaught error handlers (ensures docker logs captures crashes) ───
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.stack || err.message || err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const app = express();
const server = http.createServer(app);

// Trust reverse proxy (nginx, Caddy, etc.) for correct protocol/IP detection
app.set('trust proxy', true);

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Request logging (stdout for docker logs)
app.use((req, res, next) => {
  if (req.path === '/api/health') return next(); // Don't log health checks
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// Cache control for service worker and manifest (must always be fresh)
app.use('/sw.js', (req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Service-Worker-Allowed', '/');
  next();
});
app.use('/manifest.json', (req, res, next) => {
  res.set('Cache-Control', 'no-cache');
  next();
});

// Static files (PWA frontend)
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use(router);

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
});

// ─── WebSocket server ───
const wss = new WebSocketServer({ server, path: '/ws' });

// Track authenticated clients (only authenticated clients are in this map)
const clients = new Map();

wss.on('connection', (ws, req) => {
  let authenticated = false;
  let userId = null;

  // Auto-close unauthenticated connections after 15s
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      ws.close(4001, 'Authentication timeout');
    }
  }, 15000);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Auth message
      if (msg.type === 'auth') {
        try {
          const payload = jwt.verify(msg.token, config.JWT_SECRET);
          authenticated = true;
          userId = payload.id;
          clearTimeout(authTimeout);
          clients.set(ws, { userId, username: payload.username, role: payload.role });
          updateClientCount();
          ws.send(JSON.stringify({ type: 'auth', status: 'ok' }));
          console.log(`WS authenticated: ${payload.username} (${clients.size} clients)`);
        } catch {
          ws.send(JSON.stringify({ type: 'auth', status: 'error', error: 'Invalid token' }));
        }
        return;
      }

      // Ping/pong keepalive
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    clients.delete(ws);
    updateClientCount();
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });

  // Send initial connection ack
  ws.send(JSON.stringify({ type: 'connected' }));
});

// Expose WS client count to routes (for health check)
app.set('wsClientCount', 0);
const updateClientCount = () => app.set('wsClientCount', clients.size);

// Broadcast function for routes to use (only sends to authenticated clients)
setBroadcast((message) => {
  const payload = JSON.stringify(message);
  for (const [ws, info] of clients) {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  }
});

// Heartbeat to detect stale connections
const heartbeat = setInterval(() => {
  for (const [ws, info] of clients) {
    if (ws.readyState !== 1) {
      clients.delete(ws);
      updateClientCount();
      return;
    }
    ws.send(JSON.stringify({ type: 'heartbeat', time: Date.now() }));
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// Start server
server.listen(config.PORT, config.HOST, () => {
  console.log(`PDW Monitor running on http://${config.HOST}:${config.PORT}`);
  console.log(`WebSocket available at ws://${config.HOST}:${config.PORT}/ws`);
  if (!config.VAPID_PUBLIC_KEY) {
    console.log('Warning: VAPID keys not set. Push notifications disabled.');
    console.log('Run: npm run generate-vapid');
  }
});

// ─── Graceful shutdown ───
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed.');
  });

  // Close all WebSocket connections
  clearInterval(heartbeat);
  wss.clients.forEach((ws) => {
    try { ws.send(JSON.stringify({ type: 'shutdown' })); } catch { /* ignore */ }
    ws.close(1001, 'Server shutting down');
  });
  wss.close(() => {
    console.log('WebSocket server closed.');
  });

  // Close database
  try {
    const db = require('./db');
    db.close();
    console.log('Database closed.');
  } catch { /* already closed */ }

  // Force exit after timeout
  setTimeout(() => {
    console.log('Forcing exit after timeout.');
    process.exit(1);
  }, 10000).unref();

  // Normal exit once connections drain
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
