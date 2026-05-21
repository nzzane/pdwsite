# PDW Monitor

Pager monitoring system for POCSAG/FLEX pager traffic. Decodes RTL-SDR radio feeds, stores messages in SQLite, and serves a real-time web UI with WebSocket updates, push notifications, group filtering, and audio streaming.
Note, everything here is vibe coded, nothing publically available matched what I was after so this was born

## Architecture

All three containers live on the `br0.50` VLAN with static IPs:

```
br0.50 VLAN (10.20.50.0/24)

  10.20.50.30  ┌─────────────┐   HTTP POST    ┌─────────────┐   HTTP    ┌─────────────┐
  (Server)     │   Server    │ ◄───────────── │   Client    │           │   rtlsdr    │
               │   (WebUI)   │                │  (Decoder)  │           │  (Audio)    │
               │             │   proxy        │             │           │             │
               │ Express     │ ◄───────────── │ rtl_fm      │           │ rtl_fm      │
               │ SQLite      │   /stream      │ multimon-ng │           │ ffmpeg      │
               │ WebSocket   │                │ pdw-client  │           │ stream.js   │
               └─────────────┘                └─────────────┘           └─────────────┘
                  :3000                                                    :8090
```

- **Server** (10.20.50.30) — Express web app with SQLite, WebSocket, PWA frontend, push notifications
- **Client** (10.20.50.31) — RTL-SDR pager decoder (`rtl_fm | multimon-ng | pdw-client.js`)
- **rtlsdr** (10.20.50.32) — FireComm audio streaming (`rtl_fm | ffmpeg → MP3 stream`)

## Directory Structure

```
├── server/docker-compose.yml    # Server compose
├── client/docker-compose.yml    # Client compose
├── rtlsdr/docker-compose.yml    # RTL-SDR audio compose
├── client/pdw-client.service    # systemd unit (native, no Docker)
├── scripts/backup.sh            # Backup script for cron
├── scripts/pdw-backup.cron      # Cron example
├── .env.example                 # All config vars documented
├── Dockerfile                   # Server image
├── package.json
└── public/                      # WebUI (PWA)
```

## Quick Start

All three containers are on the `br0.50` VLAN. Build from the **repo root** so the root `.env` is picked up:

```bash
# 1. Copy and edit .env
cp .env.example .env

# 2. Start server first
docker compose -f server/docker-compose.yml up -d --build

# 3. Get the API key
docker exec pdw-monitor cat /data/.api-key

# 4. Set the API_KEY in .env, then start client + rtlsdr
docker compose -f client/docker-compose.yml up -d --build
docker compose -f rtlsdr/docker-compose.yml up -d --build
```

### Network Layout

| Container | IP | Purpose |
|-----------|-----|---------|
| pdw-monitor | `10.20.50.30` | WebUI + API |
| pdw-client | `10.20.50.31` | Pager decoder |
| pdw-rtlsdr | `10.20.50.32` | FireComm audio |

All communication happens over `br0.50` — no Docker overlay networks needed.

### systemd (client, no Docker)

For running the pager decoder natively on a Raspberry Pi or similar:

```bash
# Install dependencies
sudo apt install -y rtl-sdr multimon-ng nodejs

# Copy and edit the service file
sudo cp client/pdw-client.service /etc/systemd/system/
sudo nano /etc/systemd/system/pdw-client.service
# Set SERVER_URL, API_KEY, RTL_FREQUENCY, etc.

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable pdw-client
sudo systemctl start pdw-client
sudo systemctl status pdw-client
journalctl -u pdw-client -f
```

## Configuration

### Server (`server/docker-compose.yml`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PDW_PORT` | `3000` | Exposed port on the host |
| `JWT_SECRET` | auto-generated | Auth secret (persisted to `/data/.jwt-secret`) |
| `API_KEY` | auto-generated | Client ingestion key (persisted to `/data/.api-key`) |
| `ADMIN_USERNAME` | `admin` | Initial admin username |
| `ADMIN_PASSWORD` | `changeme` | Initial admin password |
| `VAPID_PUBLIC_KEY` | auto-generated | Web push public key |
| `VAPID_PRIVATE_KEY` | auto-generated | Web push private key |
| `VAPID_EMAIL` | `mailto:admin@example.com` | Web push contact |
| `DEDUP_WINDOW_MS` | `30000` | Dedup window for identical messages |
| `MULTIPART_TIMEOUT_MS` | `10000` | Wait time for multipart message parts |
| `MESSAGE_RETENTION_DAYS` | `180` | Auto-prune messages older than N days |
| `RTL_STREAM_URL` | empty | rtlsdr container/host URL — set to enable audio player |
| `BACKUP_DIR` | `/data/backups` | Backup storage directory |
| `MAX_BACKUPS` | `30` | Max backups to retain (auto-pruned) |
| `BACKUP_INTERVAL_HOURS` | `24` | Auto-backup frequency |

### Client (`client/docker-compose.yml`)

| Variable | Default | Description |
|----------|---------|-------------|
| `CLIENT_SERVER_URL` | `http://pdw-monitor:3000` | **Must be server IP for cross-host** |
| `API_KEY` | required | API key from server |
| `RTL_FREQUENCY` | `157.925M` | Pager frequency |
| `RTL_GAIN` | `40` | RTL-SDR LNA gain (0=AGC, 20-42=fixed) |
| `RTL_PPM` | `0` | Frequency correction (calibrate per dongle) |
| `RTL_DEVICE` | `0` | Device index or serial |
| `RTL_SAMPLE_RATE` | `22050` | Sample rate (recommended for POCSAG) |
| `RTL_SQUELCH` | `0` | Squelch level (0=off, try 15-30 if noisy) |
| `DECODERS` | `POCSAG512,POCSAG1200,FLEX` | Decoders to enable |
| `BATCH_SIZE` | `10` | Messages per HTTP POST |
| `BATCH_INTERVAL_MS` | `2000` | Max wait before sending a batch |
| `DEDUP_WINDOW_S` | `30` | Client-side dedup window |
| `EXCLUDE_CAPCODES` | empty | Capcodes to ignore (comma-separated) |
| `MAX_RETRIES` | `5` | HTTP send retry attempts |
| `PIPELINE_RESTART_DELAY_MS` | `5000` | Delay before restarting rtl_fm/multimon-ng |
| `FLEX_JOIN_MS` | `2000` | Hold FLEX messages to join split fragments (0=disabled) |
| `SILENCE_ALERT_MIN` | `0` | Alert if no pages for N minutes (0=disabled) |
| `DEBUG` | `0` | Verbose pipeline logging (set to `1`) |

### rtlsdr (`rtlsdr/docker-compose.yml`)

| Variable | Default | Description |
|----------|---------|-------------|
| `RTL_FIRE_FREQ` | `75.5875M` | FireComm frequency |
| `RTL_FIRE_MODE` | `fm` | Demodulation mode (fm/nfm/am) |
| `RTL_FIRE_GAIN` | `40` | RTL-SDR gain (0=auto, 1-50=manual dB) |
| `RTL_FIRE_SQUELCH` | `0` | Squelch level (0=open, try 10-20) |

## Features

### Web UI
- Real-time message feed via WebSocket
- PWA — installable on iOS/Android as a web app
- Push notifications for groups, keywords, and alarm levels
- Capcode aliases with colour coding, icons, and notes
- Groups for regional/category filtering
- Saved filters with date range support
- **Date range filtering** — From/To date pickers in the filter bar
- Audio player for FireComm radio stream with level metering
- Statistics dashboard (24h)
- Admin panel: Groups, Aliases, Import, Users, Settings, Backups, Logs

### Message Processing
- POCSAG (512/1200) and FLEX decoding
- **FLEX fragment auto-join** — detects overlapping content in split multimon-ng output lines and merges them into complete messages (configurable via `FLEX_JOIN_MS`, default 2000ms)
- Multipart message joining with configurable timeout
- Deduplication at both client and server level
- Call type detection (FENZ fire codes, AMPDS ambulance codes)
- Location, truck/unit, and incident number extraction
- Priority detection (PURPLE/RED/ORANGE/GREEN)
- Alarm level detection (2nd–5th alarm fires)
- FLEX/1600 capcode buffering and incident-based dedup
- **Silence alerts** — client notifies server when no pager messages received for a configurable period (`SILENCE_ALERT_MIN`), server broadcasts warning to all connected admin users via WebSocket

### Bulk Import (Admin Panel > Import)

**1. Import Capcodes from CSV** — upsert or insert-only mode.
```
Capcode,Alias,Colour,Icon,CallType,Location,Notes
1234567,MATAFRU,#f59e0b,radio,MIN,Matamata,Matamata Rural Fire Unit
7654321,ROTFRU,#2563eb,radio,MIN,Rotorua,Rotorua Rural Fire
```
Paste CSV or upload a `.csv`/`.tsv` file.

**2. Create Group from CSV** — creates a group and populates it with capcodes + aliases in one step. Ideal for setting up a region (e.g. "Taranaki") quickly.
```
Capcode,Alias,Colour,Icon,Notes
1234567,NEWPLY,#3b82f6,radio,New Plymouth Unit
7654321,WAITARA,#2563eb,radio,Waitara Unit
```

**3. Add Capcodes to Existing Group** — paste a list or CSV to bulk-add capcodes to an already-created group.

### Backups (Admin Panel > Backups)
- Full SQLite online backups (no downtime, no locking)
- Trigger from UI, API (`POST /api/admin/backup`), or cron
- Automatic pruning — keeps last 30 by default
- Script: `scripts/backup.sh`
- Cron: `scripts/pdw-backup.cron`

```bash
# Cron example (daily at 2am)
0 2 * * * root BACKUP_DIR=/data/backups MAX_BACKUPS=30 PDW_DB_PATH=/data/pdw.db /opt/pdw/scripts/backup.sh
```

## Regional Alarm Level Alerting

To get alerted **only for specific alarm levels in a specific area** (e.g. 2nd alarm fires in Taranaki):

1. **Create a group** for the region (Admin Panel > Groups > Add Group) — name it "Taranaki"
2. **Add the region's capcodes** and **keywords** (suburb names) to the group — either manually or via the CSV import
3. Go to **Settings** (sidebar) > **Alarm Level Alerts**
4. Set the minimum alarm level (e.g. "2nd Alarm and above")
5. **Check only the groups/regions** you want to monitor
6. Leave all unchecked for nationwide alerts

You'll now only receive push notifications for 2nd+ alarm fires whose capcode or content matches your Taranaki group.

## API Endpoints

### Authentication
- `POST /api/auth/login` — Login (returns JWT)
- `POST /api/auth/register` — Register (admin only)
- `GET /api/auth/me` — Current user info
- `POST /api/auth/change-password` — Change password

### Messages
- `POST /api/ingest` — Client ingestion (API key auth)
- `GET /api/messages` — Query messages (search, call_type, protocol, capcode, location, trucks, group_id, region, since, until)
- `GET /api/messages/count` — Count matching messages
- `GET /api/messages/stats` — 24h statistics

### Groups & Aliases
- `GET/POST /api/groups` — List/create groups
- `GET/PUT/DELETE /api/groups/:id` — Group detail/update/delete
- `GET/POST /api/aliases` — List/create capcode aliases
- `DELETE /api/aliases/:capcode` — Delete alias

### Import (admin only)
- `POST /api/admin/capcodes/import` — Bulk capcode import from CSV (body: `{ csv, mode }`, mode=`upsert`|`insert`)
- `POST /api/admin/groups/create-with-capcodes` — Create group + import capcodes + aliases in one step
- `POST /api/admin/groups/capcodes/import` — Add capcodes to an existing group

### Backups (admin only)
- `POST /api/admin/backup` — Create full database backup
- `GET /api/admin/backups` — List backups with size/date
- `DELETE /api/admin/backups/:filename` — Delete a backup

### Audio (rtlsdr, proxied through server)
- `GET /api/audio/status` — Stream status
- `GET /api/audio/stream` — MP3 audio stream
- `GET/PUT /api/audio/settings` — Audio settings
- `POST /api/audio/auto-squelch` — Measure noise floor, auto-set squelch

### Push Notifications
- `POST /api/push/subscribe` — Register push subscription
- `DELETE /api/push/subscribe` — Unregister
- `GET /api/push/vapid-key` — Get VAPID public key
- `POST /api/push/test` — Send test notification to current user

### Admin
- `GET/POST /api/admin/users` — User management
- `GET/PUT /api/admin/settings` — Settings (API key)
- `GET/DELETE /api/admin/error-log` — Server error log

### Client
- `POST /api/client/silence-alert` — Client reports no pages received (API key auth, broadcasts to admins)

## Upgrading

```bash
# Pull latest code
git pull

# Rebuild and restart (run from repo root)
docker compose -f server/docker-compose.yml up -d --build
docker compose -f client/docker-compose.yml up -d --build
docker compose -f rtlsdr/docker-compose.yml up -d --build
```

The `pdw-data` volume is preserved across upgrades (database, secrets, VAPID keys).

## Troubleshooting

### Client can't send messages (timeout / socket hang up)
- All containers must be on the `br0.50` VLAN. Verify: `docker exec pdw-client ip addr show`
- Check the server is reachable from the client: `docker exec pdw-client curl -sf http://10.20.50.30:3000/api/health`
- Verify the API key matches: `docker exec pdw-monitor cat /data/.api-key`
- Check the `CLIENT_SERVER_URL` in `.env` is `http://10.20.50.30:3000`
- Set `DEBUG=1` on the client for verbose logs

### Client won't start
- Check USB device access: `ls -l /dev/bus/usb`
- Verify RTL-SDR dongle is detected: `rtl_test`
- Check logs: `docker logs pdw-client`

### No messages appearing
- Verify frequency is correct for your area
- Check gain settings (try 32-40 for suburban areas)
- Calibrate PPM for your specific dongle (`rtl_test -p`)
- Enable `DEBUG=1` on the client for verbose pipeline logs

### Push notifications not working
- Push requires HTTPS (access via domain, not direct IP)
- iOS: must be added to Home Screen via Safari Share menu
- Check VAPID keys are generated: Admin Panel > Settings
- Test from Admin Panel > Settings > Test Push Notification

### Web UI shows unformatted page (no CSS/JS)
- The container runs as a non-root user. If static files return `EACCES` errors, rebuild with `--build` — the Dockerfile includes a `chown` step.
- Clear browser cache or hard-refresh (Ctrl+Shift+R)

### Database grows too large
- Set `MESSAGE_RETENTION_DAYS` to a lower value (default 180). Messages older than this are auto-pruned every 6 hours and on startup.
- Run manual backups from Admin Panel > Backups

### Healthcheck shows unhealthy on quiet channels
- The client healthcheck checks for running processes (`rtl_fm`, `multimon-ng`, `pdw-client`), not message timestamps. It won't falsely trigger on quiet radio periods.
