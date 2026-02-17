const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { router, setBroadcast } = require('./routes');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

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

// Track authenticated clients
const clients = new Map();

wss.on('connection', (ws, req) => {
  let authenticated = false;
  let userId = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Auth message
      if (msg.type === 'auth') {
        try {
          const payload = jwt.verify(msg.token, config.JWT_SECRET);
          authenticated = true;
          userId = payload.id;
          clients.set(ws, { userId, username: payload.username, role: payload.role });
          updateClientCount();
          ws.send(JSON.stringify({ type: 'auth', status: 'ok' }));
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
    clients.delete(ws);
    updateClientCount();
  });

  // Send initial connection ack
  ws.send(JSON.stringify({ type: 'connected' }));
});

// Expose WS client count to routes (for health check)
app.set('wsClientCount', 0);
const updateClientCount = () => app.set('wsClientCount', clients.size);

// Broadcast function for routes to use
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
  wss.clients.forEach((ws) => {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'heartbeat', time: Date.now() }));
  });
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
    ws.send(JSON.stringify({ type: 'shutdown' }));
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
