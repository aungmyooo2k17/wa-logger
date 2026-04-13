import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import { setTimeout as delay } from "node:timers/promises";
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

// Aggressive reconnection & health monitoring (no disconnects allowed)
const RECONNECT_POLICY = {
  initialMs: 0,           // reconnect IMMEDIATELY (no delay)
  maxMs: 0,               // no max delay
  factor: 1,              // no exponential backoff
  jitter: 0,              // no jitter
  maxAttempts: Infinity,  // unlimited retries (never give up)
};
const HEARTBEAT_SECONDS = 10;                // check health every 10s
const WATCHDOG_TIMEOUT_MS = 60 * 1000;       // 1 min no messages → reconnect
const WATCHDOG_CHECK_MS = 10_000;             // check every 10s

function computeBackoff(policy, attempt) {
  const base = policy.initialMs * Math.pow(policy.factor, Math.max(attempt - 1, 0));
  const jitter = base * policy.jitter * Math.random();
  return Math.min(policy.maxMs, Math.round(base + jitter));
}

async function sleep(ms) {
  if (ms <= 0) return;
  await delay(ms);
}

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

async function connectOnce() {
  return new Promise(async (resolve, reject) => {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
    });

    // Track connection metrics
    let lastInboundAt = null;
    let messagesHandled = 0;
    const startedAt = Date.now();
    let connectedAt = null;
    let heartbeatTimer = null;
    let watchdogTimer = null;

    // Prevent unhandled WebSocket errors from crashing the process
    sock.ws?.on("error", (err) => {
      console.error("[WebSocket Error]", err.message);
      // WebSocket errors are handled by Baileys' connection.update event
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        qrcode.generate(qr, { small: true });
        console.log("Scan the QR code above with WhatsApp on your phone.\n");
      }
      if (connection === "open") {
        connectedAt = Date.now();
        console.log("Connected to WhatsApp. Listening for all messages...");
        console.log(`Messages saved to: ${MESSAGES_FILE}`);
        console.log(`Media saved to:    ${MEDIA_DIR}/\n`);

        // Start heartbeat timer
        heartbeatTimer = setInterval(() => {
          const uptimeS = Math.floor((Date.now() - startedAt) / 1000);
          const lastInboundAgo = lastInboundAt
            ? Math.floor((Date.now() - lastInboundAt) / 1000)
            : "never";
          console.log(
            `[HEARTBEAT] Uptime: ${uptimeS}s | Messages: ${messagesHandled} | Last inbound: ${lastInboundAgo}s ago`
          );
        }, HEARTBEAT_SECONDS * 1000);

        // Start watchdog timer
        watchdogTimer = setInterval(() => {
          const baselineAt = lastInboundAt ?? startedAt;
          const staleForMs = Date.now() - baselineAt;
          if (staleForMs > WATCHDOG_TIMEOUT_MS) {
            const staleForMin = Math.floor(staleForMs / 1000 / 60);
            console.warn(
              `[WATCHDOG] No messages for ${staleForMin}m. Forcing reconnect...`
            );
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            if (watchdogTimer) clearInterval(watchdogTimer);
            sock.end();
          }
        }, WATCHDOG_CHECK_MS);
      }
      if (connection === "close") {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (watchdogTimer) clearInterval(watchdogTimer);

        const statusCode =
          lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          reject(new Error("LOGGED_OUT"));
        } else {
          reject(new Error(`DISCONNECTED:${statusCode}`));
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      for (const msg of messages) {
        // Skip WhatsApp internal protocol messages (key distribution, read receipts, etc.)
        if (msg.message?.protocolMessage || msg.message?.senderKeyDistributionMessage) {
          continue;
        }

        lastInboundAt = Date.now();
        messagesHandled++;

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

    // Keep the promise open — close events will reject it
  });
}

async function runBot() {
  let reconnectAttempts = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await connectOnce();
    } catch (err) {
      const errMsg = err?.message || String(err);

      // Logged out — give up
      if (errMsg === "LOGGED_OUT") {
        console.error("Logged out. Delete the auth/ folder and restart to re-link.");
        process.exit(1);
      }

      // Extract status code if present
      const statusMatch = errMsg.match(/DISCONNECTED:(\d+)/);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null;

      // Non-retryable statuses
      if (statusCode === 401 || statusCode === 440) {
        console.error(`Non-retryable error (${statusCode}). Exiting.`);
        process.exit(1);
      }

      // Increment reconnect attempt counter
      reconnectAttempts++;
      // Note: maxAttempts is Infinity, so we never give up

      // Compute backoff delay
      const delayMs = computeBackoff(RECONNECT_POLICY, reconnectAttempts);
      console.log(
        `[RECONNECT] Attempt ${reconnectAttempts}/${RECONNECT_POLICY.maxAttempts}. Reconnecting in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }
}

runBot().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
