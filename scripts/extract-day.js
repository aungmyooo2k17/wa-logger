#!/usr/bin/env node
// Builds an enriched Markdown document of one group's messages for a given date.
// Usage: node extract-day.js --date YYYY-MM-DD --group-jid JID
// If --group-jid is omitted, extracts all groups separately and prints headers.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const PROJECT_DIR = path.join(import.meta.dirname, "..");
const INDEX_FILE = path.join(PROJECT_DIR, "data", "message-index.jsonl");
const TRANSCRIPTS_DIR = path.join(PROJECT_DIR, "data", "transcripts");
const CONFIG_FILE = path.join(PROJECT_DIR, "config", "groups.json");

const { values } = parseArgs({
  options: {
    date: { type: "string" },
    "group-jid": { type: "string" },
  },
});

const targetDate = values.date;
if (!targetDate) {
  console.error("Usage: node extract-day.js --date YYYY-MM-DD [--group-jid JID]");
  process.exit(1);
}

// Load group config for participant name mapping
let groupConfig = { groups: [] };
try {
  groupConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
} catch {
  // no config yet
}

function getGroupByJid(jid) {
  return groupConfig.groups.find((g) => g.jid === jid);
}

function resolveParticipantName(group, pushName, participant) {
  if (group?.participants) {
    // Check if participant phone matches any configured name
    for (const [phone, name] of Object.entries(group.participants)) {
      if (participant?.includes(phone.replace(/[^0-9]/g, ""))) return name;
    }
  }
  return pushName || participant || "Unknown";
}

// Read JSONL index
if (!fs.existsSync(INDEX_FILE)) {
  console.error(`Index file not found: ${INDEX_FILE}`);
  console.error("Run: node scripts/migrate-index.js");
  process.exit(1);
}

const lines = fs.readFileSync(INDEX_FILE, "utf-8").split("\n").filter(Boolean);
const messages = lines
  .map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  })
  .filter(Boolean)
  .filter((m) => m.date?.startsWith(targetDate));

if (messages.length === 0) {
  console.error(`No messages found for ${targetDate}`);
  process.exit(0);
}

// Filter by group if specified
const targetJid = values["group-jid"];
const filtered = targetJid ? messages.filter((m) => m.from === targetJid) : messages;

if (filtered.length === 0) {
  console.error(`No messages found for group ${targetJid} on ${targetDate}`);
  process.exit(0);
}

// Group messages by chat JID
const byGroup = new Map();
for (const msg of filtered) {
  const jid = msg.from;
  if (!byGroup.has(jid)) byGroup.set(jid, []);
  byGroup.get(jid).push(msg);
}

// Sort each group's messages by timestamp
for (const msgs of byGroup.values()) {
  msgs.sort((a, b) => a.timestamp - b.timestamp);
}

// Format output
const output = [];

for (const [jid, msgs] of byGroup) {
  const group = getGroupByJid(jid);
  const groupLabel = group?.displayName || msgs[0]?.groupName || jid;

  if (!targetJid) {
    output.push(`# ${groupLabel}`);
    output.push("");
  }

  for (const msg of msgs) {
    const time = new Date(msg.timestamp * 1000).toISOString().slice(11, 16);
    const sender = msg.fromMe
      ? "Me"
      : resolveParticipantName(group, msg.pushName, msg.participant);

    // Text content
    const textPart = msg.text || "";

    // Media label
    let mediaLabel = "";
    if (msg.mediaType && msg.mediaType !== "conversation") {
      const typeMap = {
        imageMessage: "Image",
        videoMessage: "Video",
        audioMessage: "Voice Note",
        documentMessage: "Document",
        stickerMessage: "Sticker",
        lottieStickerMessage: "Sticker",
        contactMessage: "Contact",
      };
      mediaLabel = typeMap[msg.mediaType] || msg.mediaType;
    }

    // Build message line
    const parts = [];
    if (mediaLabel) parts.push(`[${mediaLabel}]`);
    if (textPart) parts.push(textPart);
    const content = parts.join(" ") || "[empty]";

    output.push(`**[${time}] ${sender}:** ${content}`);

    // Inline transcript if available
    if (msg.mediaPath) {
      const msgId = msg.id;
      const transcriptPath = path.join(TRANSCRIPTS_DIR, targetDate, `${msgId}.txt`);
      if (fs.existsSync(transcriptPath)) {
        const transcript = fs.readFileSync(transcriptPath, "utf-8").trim();
        if (transcript) {
          output.push(`> **Transcript:** ${transcript}`);
        }
      }
    }
  }

  output.push("");
}

process.stdout.write(output.join("\n"));
