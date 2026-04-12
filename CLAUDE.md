# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

wa-logger is a WhatsApp message logger built on `@whiskeysockets/baileys` (v7 RC). It connects as a linked device via QR code, then records every incoming and outgoing message (text + media) to local files.

## Running

```bash
npm start          # node index.js — starts the bot, shows QR on first run
```

On first launch, scan the terminal QR code with WhatsApp to link. Auth state persists in `auth/`.

## Architecture

Single-file app (`index.js`, ESM). Key flow:

1. **Auth** — `useMultiFileAuthState("auth/")` manages session credentials across restarts.
2. **Connection** — `makeWASocket` opens the WA Web socket. On disconnect (non-logout), it recursively calls `start()` to reconnect.
3. **Message handling** — `messages.upsert` event processes every message: extracts text, downloads media, appends a JSON entry to `messages.json`.
4. **Media download** — binary media (images, video, audio, documents, stickers) is saved to `media/` with date-prefixed filenames.

## Data Files

- `messages.json` — append-only JSON array; each entry contains id, sender, text, media path, and the full raw Baileys message object.
- `media/` — downloaded media files named `{date}_{msgId}_{originalName}` or `{date}_{msgId}.{ext}`.
- `auth/` — Baileys multi-file auth state (session keys). **Do not commit or share.**

## Dependencies

- `@whiskeysockets/baileys` — WhatsApp Web API client
- `pino` — logger (set to silent, required by Baileys)
- `qrcode-terminal` — renders QR code for device linking
