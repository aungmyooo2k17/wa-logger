# WA-Logger

WhatsApp message logger and daily summarization platform. Connects as a linked device via QR code, records all messages and media, then generates AI-powered daily summaries per group using Claude CLI.

## Features

- **Message logging** -- captures all incoming/outgoing messages (text, images, audio, video, documents, stickers, contacts)
- **Media download** -- saves all shared media to disk
- **Auto-discovery** -- automatically detects WhatsApp groups and configures them with sensible defaults
- **Daily summarization** -- generates per-group summaries using Claude Haiku (cost-effective)
- **Multi-language** -- supports English, Chinese, Thai, Malay, Cantonese with auto-detection
- **Media pre-processing** -- transcribes audio (Whisper), analyzes images (Claude Haiku), extracts PDF text
- **Purchase tracking** -- detects and extracts expenses from designated groups
- **Web dashboard** -- view summaries, track expenses, configure groups, trigger pipeline
- **24/7 always-on** -- aggressive reconnection, health monitoring, auto-restart on crash

## Quick Start

```bash
npm install

# 1. Start the WhatsApp logger (scan QR on first run)
npm start

# 2. Start the web dashboard (http://localhost:3456)
npm run dashboard

# 3. Run the daily summarization pipeline
bash scripts/daily-pipeline.sh 2026-04-12
```

## 24/7 Always-On Setup (Production)

To run the logger continuously with automatic reconnection, health monitoring, and crash recovery:

### 1. Install PM2 (process manager)

```bash
npm install -g pm2
```

### 2. Auto-Discover Groups & Start the bot with PM2

Groups are automatically discovered from incoming messages and added to `config/groups.json` with default settings:

```bash
pm2 start scripts/start.js --name "wa-logger" --interpreter node
```

This wrapper script:
- ✅ Scans all incoming WhatsApp groups
- ✅ Auto-adds new groups to config (English, Singapore currency, all features enabled)
- ✅ Runs on every bot restart
- ✅ No manual group configuration needed!

**Manual auto-discovery** (if needed):
```bash
node scripts/auto-discover-groups.js
```

### 3. Save and enable startup on reboot (optional)

```bash
pm2 save
pm2 startup
```

Then copy and run the command that PM2 outputs (requires `sudo`).

### 4. Monitor the bot

```bash
# Watch live logs
pm2 logs wa-logger

# Check status
pm2 status

# Real-time dashboard
pm2 monit
```

### Features

The bot includes battle-tested reliability features from OpenClaw:

- **Heartbeat monitor** — logs connection health every 60 seconds
- **Watchdog timer** — auto-reconnects if no messages for 5 minutes
- **Exponential backoff** — intelligent reconnection with delays (2s → 30s max)
- **WebSocket error handling** — prevents crashes from network errors
- **Attempt limiting** — gives up after 12 failed attempts to prevent infinite loops
- **Smart reset** — resets attempt counter after stable connection (>60s)

### Log Output

**Healthy connection:**
```
[HEARTBEAT] Uptime: 3600s | Messages: 42 | Last inbound: 30s ago
```

**Reconnecting after network drop:**
```
[RECONNECT] Attempt 1/12. Reconnecting in 2000ms...
[RECONNECT] Attempt 2/12. Reconnecting in 3600ms...
[RECONNECT] Attempt 3/12. Reconnecting in 6480ms...
```

**Watchdog timeout (no messages for 5 min):**
```
[WATCHDOG] No messages for 5m. Forcing reconnect...
```

## Automatic Group Discovery

The bot automatically detects all WhatsApp groups and adds them to `config/groups.json` with default settings:

```json
{
  "jid": "120363163512901566@g.us",
  "slug": "group-name",
  "displayName": "Group Name",
  "active": true,
  "template": "business-summary",
  "language": "en",
  "currency": "SGD",
  "features": {
    "expenseTracking": true,
    "receiptOCR": true,
    "audioTranscription": true
  },
  "participants": {}
}
```

**How it works:**
1. Bot receives messages from a new group
2. Next restart (or manual run), `scripts/auto-discover-groups.js` scans `messages.json`
3. New groups are auto-added to `config/groups.json` with defaults
4. All features enabled: expense tracking, receipt OCR, audio transcription
5. Language: English, Currency: Singapore Dollar

**Run auto-discovery manually:**
```bash
node scripts/auto-discover-groups.js
```

**Change defaults after discovery:**
- Edit `config/groups.json` to customize per-group settings
- Disable groups by setting `"active": false`
- Change templates: `business-summary`, `expense-tracker`, `social-highlights`

### Useful PM2 Commands

```bash
pm2 restart wa-logger        # Restart the bot
pm2 stop wa-logger           # Stop the bot
pm2 delete wa-logger         # Remove from PM2
pm2 logs wa-logger --lines 100  # View last 100 log lines
```

## Architecture

```
wa-logger (always running) --> messages.json + media/ + message-index.jsonl
                                      |
                        daily-pipeline.sh (cron / manual)
                                      |
                    +----------------------------------+
                    | process-media.js                  |
                    |   Audio --> Whisper (local STT)   |
                    |   Images --> Ollama vision        |
                    |   PDFs --> text extraction        |
                    +----------------------------------+
                                      |
                    +----------------------------------+
                    | generate-summary.sh               |
                    |   Per group: extract-day.js -->   |
                    |   Claude CLI + template           |
                    +----------------------------------+
                                      |
                    +----------------------------------+
                    | server/app.js (Express)           |
                    |   Dashboard, summaries, expenses  |
                    +----------------------------------+
```

## Project Structure

```
wa-logger/
├── index.js                 # WhatsApp logger (always running)
├── config/
│   ├── groups.json          # Per-group config (template, language, features)
│   └── settings.json        # Global settings (whisper, ollama, port)
├── scripts/
│   ├── daily-pipeline.sh    # Cron entry point: media processing + summarization
│   ├── process-media.js     # Audio/image/PDF pre-processing
│   ├── extract-day.js       # Builds enriched message doc for one group+date
│   ├── generate-summary.sh  # Calls Claude CLI per active group
│   ├── read-groups.js       # Helper: reads active groups from config
│   ├── extract-purchases.js # Helper: extracts purchase JSON from summaries
│   ├── merge-purchases.js   # Helper: merges purchases into daily file
│   └── migrate-index.js     # One-time: backfill JSONL index from messages.json
├── templates/
│   ├── expense-tracker.md   # Detects expenses, does math, extracts structured JSON
│   ├── business-summary.md  # Action items, decisions, deadlines
│   └── social-highlights.md # Key events, plans, notable moments
├── data/
│   ├── message-index.jsonl  # Lightweight message index
│   ├── transcripts/         # Pre-processed media transcripts
│   ├── summaries/           # Daily summaries per group (markdown)
│   └── purchases/           # Structured purchase data (JSON)
├── server/
│   ├── app.js               # Express server
│   ├── routes/api.js        # REST API
│   └── public/index.html    # Dashboard UI
├── messages.json            # Full message log (auto-generated)
├── media/                   # Downloaded media files (auto-generated)
└── auth/                    # WhatsApp session credentials (auto-generated)
```

## Group Configuration

Each group gets its own config in `config/groups.json`:

```json
{
  "groups": [
    {
      "jid": "120363425881701415@g.us",
      "slug": "family-expenses",
      "displayName": "Family Expenses",
      "active": true,
      "template": "expense-tracker",
      "language": "en",
      "currency": "SGD",
      "features": {
        "expenseTracking": true,
        "receiptOCR": true,
        "audioTranscription": true
      },
      "participants": {
        "+6512345678": "Alice"
      }
    }
  ]
}
```

**Templates:**
- `expense-tracker` -- financial summaries with expense tables, balance sheets, receipt extraction
- `business-summary` -- action items, decisions, deadlines, unresolved questions
- `social-highlights` -- daily highlights, key info, plans, notable moments

## Media Pre-Processing

### Audio Transcription (Whisper)

Audio files are transcribed using OpenAI Whisper via Docker:

```bash
# Build Whisper Docker image
docker build -f Dockerfile.whisper -t wa-whisper .
```

Features:
- ✅ Auto-detects language (English, Chinese, Thai, Malay, etc.)
- ✅ Saves transcripts to `data/transcripts/`
- ✅ Integrated in daily pipeline

### Image OCR & Analysis (Claude)

Images are analyzed using Claude Haiku model (cheapest):

```bash
# Requires Claude API access (set via ANTHROPIC_API_KEY)
# Analyzes receipts, invoices, text extraction automatically
```

Features:
- ✅ Receipt & invoice extraction
- ✅ Text recognition (OCR)
- ✅ Multi-language support
- ✅ Cost-effective (Haiku model)

## Scheduling

Set up a cron job to run the pipeline daily:

```bash
0 3 * * * bash /home/aung/tools/wa-logger/scripts/daily-pipeline.sh >> /home/aung/tools/wa-logger/data/pipeline.log 2>&1
```

Or trigger manually from the web dashboard at http://localhost:3456.

## Web Dashboard

Start with `npm run dashboard`, then open http://localhost:3456.

- **Dashboard** -- active groups, pipeline runner, unconfigured group detection
- **Summaries** -- browse daily summaries by date, rendered as formatted markdown
- **Expenses** -- date range filter, per-person totals, full purchase table
- **Settings** -- configure groups (template, language, active) and global settings
