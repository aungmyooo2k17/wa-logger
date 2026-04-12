# WA-Logger

WhatsApp message logger and daily summarization platform. Connects as a linked device via QR code, records all messages and media, then generates AI-powered daily summaries per group using Claude CLI.

## Features

- **Message logging** -- captures all incoming/outgoing messages (text, images, audio, video, documents, stickers, contacts)
- **Media download** -- saves all shared media to disk
- **Daily summarization** -- generates per-group summaries using Claude CLI with customizable templates
- **Multi-language** -- supports English, Chinese, Thai, Malay, Cantonese
- **Media pre-processing** -- transcribes audio (Whisper), analyzes images (Ollama), extracts PDF text
- **Purchase tracking** -- detects and extracts expenses from designated groups
- **Web dashboard** -- view summaries, track expenses, configure groups, trigger pipeline

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

## Optional Dependencies

The logger works standalone. These are needed for media pre-processing:

```bash
# Audio transcription (speech-to-text)
pip install openai-whisper

# Image analysis and OCR
ollama pull llava
```

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
