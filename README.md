# PDW Monitor

A modern web-based pager monitoring system for POCSAG and FLEX protocols. Decodes pager traffic from an RTL-SDR dongle and presents it in a real-time, filterable web interface with push notifications. Installable as a native app on Android and iOS.

## Features

- **Live Feed**: Real-time pager message stream via WebSocket
- **Protocol Support**: POCSAG 512, POCSAG 1200, and FLEX
- **Multi-part Message Joining**: Automatically reassembles fragmented pager messages
- **Deduplication**: Filters duplicate messages within a configurable time window
- **Call Type Detection**: Automatically classifies messages (MVC, MIN, AMBO, Structure Fire, etc.)
- **Location & Truck Extraction**: Parses addresses and unit identifiers from message content
- **Filtering**: Filter by capcode, call type, location, trucks, free-text search, or group
- **Groups**: Admin-defined capcode groups (e.g. Wellington Region, Taranaki, etc.)
- **User Accounts**: Login system with admin and user roles
- **Favourites**: Users can favourite groups and receive push notifications for them
- **Saved Filters**: Save and recall filter presets
- **Capcode Aliases**: Give friendly names and colours to known capcodes
- **Push Notifications**: Web Push notifications for favourited groups (Android/iOS/Desktop)
- **PWA**: Installable as a home-screen app on mobile devices
- **Offline Support**: Service worker caches the UI for offline access
- **Stats Dashboard**: Message counts, call type breakdown, top capcodes

## Architecture

```
RTL-SDR Dongle
    |
    v
rtl_fm  -->  multimon-ng  -->  pdw-client.js  --HTTP POST-->  Server (Express)
                                                                  |
                                                           SQLite Database
                                                                  |
                                                         WebSocket broadcast
                                                                  |
                                                           Web Browser (PWA)
```

- **Client Script** (`client/pdw-client.js`): Runs on the machine with the RTL-SDR. Spawns `rtl_fm | multimon-ng`, parses output, joins multipart messages, deduplicates, and sends batches to the server API.
- **Server** (`server/index.js`): Express HTTP server with REST API, WebSocket for real-time push, and Web Push for notifications.
- **Frontend** (`public/`): Vanilla JS PWA - no build step required.

## Prerequisites

- **Node.js** 18+ (recommended: 20 LTS)
- **RTL-SDR drivers** (`rtl-sdr` package)
- **multimon-ng** (pager decoder)

### Install RTL-SDR and multimon-ng (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install rtl-sdr multimon-ng
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env - at minimum set JWT_SECRET and API_KEY
```

### 3. Generate VAPID keys (for push notifications)

```bash
npm run generate-vapid
# Copy the output keys into your .env file
```

### 4. Create admin account

```bash
npm run setup
```

### 5. Start the server

```bash
npm start
```

The server runs on `http://localhost:3000` by default.

### 6. Start the client script (on the RTL-SDR machine)

```bash
API_KEY=your-api-key SERVER_URL=http://your-server:3000 npm run client
```

Or pipe multimon-ng output directly:

```bash
rtl_fm -f 157.925M -g 40 -s 22050 - | multimon-ng -t raw -a POCSAG512 -a POCSAG1200 -a FLEX - | \
  API_KEY=your-key SERVER_URL=http://your-server:3000 READ_STDIN=1 node client/pdw-client.js
```

## Mobile Installation (PWA)

### Android
1. Open the site in Chrome
2. Tap the menu (three dots) > "Add to Home screen"
3. The app will appear as a native app

### iPhone/iPad
1. Open the site in Safari
2. Tap the Share button > "Add to Home Screen"
3. The app will appear as a native app

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server bind address |
| `JWT_SECRET` | random | Secret for JWT tokens |
| `API_KEY` | `change-me-pdw-api-key` | Shared key for client ingestion |
| `VAPID_PUBLIC_KEY` | (empty) | Web Push public key |
| `VAPID_PRIVATE_KEY` | (empty) | Web Push private key |
| `VAPID_EMAIL` | `mailto:admin@example.com` | VAPID contact email |
| `DEDUP_WINDOW_MS` | `30000` | Dedup window in milliseconds |
| `MULTIPART_TIMEOUT_MS` | `10000` | Multipart join timeout |
| `RTL_FREQUENCY` | `157.925M` | RTL-SDR frequency |
| `RTL_GAIN` | `40` | RTL-SDR gain |
| `RTL_PPM` | `0` | RTL-SDR PPM correction |
| `RTL_DEVICE` | `0` | RTL-SDR device index |
| `DECODERS` | `POCSAG512,POCSAG1200,FLEX` | Enabled decoders |

## Admin Features

After logging in as admin:

- **Groups**: Create region/category groups and assign capcodes to them
- **Capcode Aliases**: Give friendly names to capcodes (e.g. "Wellington Fire" for capcode 1234567)
- **User Management**: Create/delete user accounts, toggle admin roles

## API Reference

All API endpoints require authentication via `Authorization: Bearer <token>` header, except for the ingestion endpoint which uses `X-API-Key`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/register` | Register user (admin only) |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/messages` | List messages (supports filtering) |
| GET | `/api/messages/stats` | Get message statistics |
| GET | `/api/groups` | List groups |
| POST | `/api/groups` | Create group (admin only) |
| GET | `/api/favourites` | List user favourites |
| POST | `/api/favourites/:groupId` | Add favourite |
| POST | `/api/ingest` | Ingest messages (API key auth) |
