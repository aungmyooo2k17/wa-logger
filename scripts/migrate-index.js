#!/usr/bin/env node
// One-time migration: backfill data/message-index.jsonl from messages.json
import fs from "node:fs";
import path from "node:path";

const PROJECT_DIR = path.join(import.meta.dirname, "..");
const MESSAGES_FILE = path.join(PROJECT_DIR, "messages.json");
const INDEX_FILE = path.join(PROJECT_DIR, "data", "message-index.jsonl");

// Ensure data dir exists
fs.mkdirSync(path.join(PROJECT_DIR, "data"), { recursive: true });

console.log("Reading messages.json...");
const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf-8"));
console.log(`Found ${messages.length} messages.`);

const lines = messages.map((entry) =>
  JSON.stringify({
    id: entry.id,
    from: entry.from,
    fromMe: entry.fromMe,
    isGroup: entry.isGroup,
    groupName: entry.groupName || null,
    participant: entry.participant,
    pushName: entry.pushName,
    timestamp: entry.timestamp,
    date: entry.date,
    text: entry.text,
    mediaType: entry.mediaType,
    mediaPath: entry.media?.path || null,
    mediaMimetype: entry.media?.mimetype || null,
  })
);

fs.writeFileSync(INDEX_FILE, lines.join("\n") + "\n", "utf-8");
console.log(`Wrote ${lines.length} lines to ${INDEX_FILE}`);
