import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import qrcode from "qrcode-terminal";

const AUTH_DIR = path.join(import.meta.dirname, "auth");
const MESSAGES_FILE = path.join(import.meta.dirname, "messages.json");
const MEDIA_DIR = path.join(import.meta.dirname, "media");
const DATA_DIR = path.join(import.meta.dirname, "data");
const INDEX_FILE = path.join(DATA_DIR, "message-index.jsonl");
const logger = pino({ level: "silent" });

// Ensure directories exist
for (const dir of [MEDIA_DIR, DATA_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Cache group names to avoid repeated lookups
const groupNameCache = new Map();

const MEDIA_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "audio/ogg; codecs=opus": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/zip": ".zip",
};

const MEDIA_MESSAGE_TYPES = [
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "documentMessage",
  "stickerMessage",
  "lottieStickerMessage",
];

function loadMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      return JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf-8"));
    }
  } catch {
    // corrupted file, start fresh
  }
  return [];
}

function saveMessage(entry) {
  const messages = loadMessages();
  messages.push(entry);
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2), "utf-8");
}

function extractMessageText(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.listResponseMessage?.title ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    null
  );
}

function getMediaInfo(msg) {
  const m = msg.message;
  if (!m) return null;
  for (const type of MEDIA_MESSAGE_TYPES) {
    if (m[type]) {
      const mimetype = m[type].mimetype || "";
      const fileName = m[type].fileName || null;
      return { type, mimetype, fileName };
    }
  }
  return null;
}

function resolveExtension(mimetype, fileName) {
  // Use original file extension if available
  if (fileName) {
    const ext = path.extname(fileName);
    if (ext) return ext;
  }
  return MEDIA_EXTENSIONS[mimetype] || `.${mimetype.split("/")[1] || "bin"}`;
}

async function downloadMedia(msg, msgId, timestamp) {
  const mediaInfo = getMediaInfo(msg);
  if (!mediaInfo) return null;

  try {
    const buffer = await downloadMediaMessage(msg, "buffer", {});
    const ext = resolveExtension(mediaInfo.mimetype, mediaInfo.fileName);
    const datePrefix = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const safeName = mediaInfo.fileName
      ? mediaInfo.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")
      : null;
    const filename = safeName
      ? `${datePrefix}_${msgId}_${safeName}`
      : `${datePrefix}_${msgId}${ext}`;
    const filePath = path.join(MEDIA_DIR, filename);

    fs.writeFileSync(filePath, buffer);
    console.log(`  -> Media saved: media/${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
    return { path: `media/${filename}`, size: buffer.length, mimetype: mediaInfo.mimetype };
  } catch (err) {
    console.error(`  -> Media download failed: ${err.message}`);
    return { path: null, error: err.message };
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log("Scan the QR code above with WhatsApp on your phone.\n");
    }
    if (connection === "open") {
      console.log("Connected to WhatsApp. Listening for all messages...");
      console.log(`Messages saved to: ${MESSAGES_FILE}`);
      console.log(`Media saved to:    ${MEDIA_DIR}/\n`);
    }
    if (connection === "close") {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      if (loggedOut) {
        console.log("Logged out. Delete the auth/ folder and restart to re-link.");
        process.exit(1);
      }
      console.log(`Disconnected (status ${statusCode}). Reconnecting...`);
      start();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const msg of messages) {
      // Skip WhatsApp internal protocol messages (key distribution, read receipts, etc.)
      if (msg.message?.protocolMessage || msg.message?.senderKeyDistributionMessage) {
        continue;
      }

      const text = extractMessageText(msg);
      const from = msg.key.remoteJid;
      const isGroup = from?.endsWith("@g.us") ?? false;
      const fromMe = msg.key.fromMe ?? false;
      const participant = msg.key.participant || null;
      const pushName = msg.pushName || null;
      const timestamp = typeof msg.messageTimestamp === "number"
        ? msg.messageTimestamp
        : Number(msg.messageTimestamp);

      // Resolve group name
      let groupName = null;
      if (isGroup) {
        if (groupNameCache.has(from)) {
          groupName = groupNameCache.get(from);
        } else {
          try {
            const metadata = await sock.groupMetadata(from);
            groupName = metadata.subject || null;
            if (groupName) groupNameCache.set(from, groupName);
          } catch {
            // group metadata unavailable
          }
        }
      }

      // Console log for live feedback
      const direction = fromMe ? "SENT" : "RECV";
      const chat = isGroup ? `group:${groupName || from}` : from;
      const sender = fromMe ? "me" : (pushName || participant || from);
      const mediaType = msg.message
        ? Object.keys(msg.message).find((k) => k !== "messageContextInfo")
        : null;
      const preview = text ? text.slice(0, 80) : `[${mediaType || "no-text"}]`;
      console.log(`[${new Date(timestamp * 1000).toISOString()}] ${direction} | ${chat} | ${sender}: ${preview}`);

      // Download media if present
      const media = await downloadMedia(msg, msg.key.id, timestamp);

      const entry = {
        id: msg.key.id,
        from,
        fromMe,
        isGroup,
        groupName,
        participant,
        pushName,
        timestamp,
        date: new Date(timestamp * 1000).toISOString(),
        type,
        text,
        mediaType,
        media,
        raw: msg,
      };

      saveMessage(entry);

      // Append lightweight index line for the summarization pipeline
      const indexLine = JSON.stringify({
        id: entry.id, from: entry.from, fromMe: entry.fromMe,
        isGroup: entry.isGroup, groupName: entry.groupName,
        participant: entry.participant, pushName: entry.pushName,
        timestamp: entry.timestamp, date: entry.date, text: entry.text,
        mediaType: entry.mediaType,
        mediaPath: entry.media?.path || null,
        mediaMimetype: entry.media?.mimetype || null,
      });
      fs.appendFileSync(INDEX_FILE, indexLine + "\n");
    }
  });
}

start().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
