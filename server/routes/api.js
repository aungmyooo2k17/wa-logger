import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const router = Router();

const PROJECT_DIR = path.join(import.meta.dirname, "..", "..");
const CONFIG_DIR = path.join(PROJECT_DIR, "config");
const DATA_DIR = path.join(PROJECT_DIR, "data");
const SUMMARIES_DIR = path.join(DATA_DIR, "summaries");
const PURCHASES_DIR = path.join(DATA_DIR, "purchases");
const INDEX_FILE = path.join(DATA_DIR, "message-index.jsonl");
const MESSAGES_FILE = path.join(PROJECT_DIR, "messages.json");

function readIndex() {
  try {
    return fs.readFileSync(INDEX_FILE, "utf-8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// --- Groups ---

router.get("/groups", (req, res) => {
  const config = readJSON(path.join(CONFIG_DIR, "groups.json")) || { groups: [] };
  res.json(config.groups);
});

router.get("/groups/:slug", (req, res) => {
  const config = readJSON(path.join(CONFIG_DIR, "groups.json")) || { groups: [] };
  const group = config.groups.find((g) => g.slug === req.params.slug);
  if (!group) return res.status(404).json({ error: "Group not found" });
  res.json(group);
});

router.put("/groups/:slug", (req, res) => {
  const configFile = path.join(CONFIG_DIR, "groups.json");
  const config = readJSON(configFile) || { groups: [] };
  const idx = config.groups.findIndex((g) => g.slug === req.params.slug);
  if (idx === -1) return res.status(404).json({ error: "Group not found" });
  config.groups[idx] = { ...config.groups[idx], ...req.body };
  writeJSON(configFile, config);
  res.json(config.groups[idx]);
});

router.post("/groups", (req, res) => {
  const configFile = path.join(CONFIG_DIR, "groups.json");
  const config = readJSON(configFile) || { groups: [] };
  const newGroup = req.body;
  if (!newGroup.jid || !newGroup.slug) {
    return res.status(400).json({ error: "jid and slug are required" });
  }
  if (config.groups.some((g) => g.slug === newGroup.slug)) {
    return res.status(409).json({ error: "Group slug already exists" });
  }
  const group = {
    jid: newGroup.jid,
    slug: newGroup.slug,
    displayName: newGroup.displayName || newGroup.slug,
    active: true,
    template: newGroup.template || "social-highlights",
    language: newGroup.language || "en",
    currency: newGroup.currency || "USD",
    features: newGroup.features || {
      expenseTracking: false,
      receiptOCR: false,
      audioTranscription: true,
    },
    participants: newGroup.participants || {},
  };
  config.groups.push(group);
  writeJSON(configFile, config);
  res.status(201).json(group);
});

// --- Group Stats ---

router.get("/groups/:slug/stats", (req, res) => {
  const slug = req.params.slug;
  const config = readJSON(path.join(CONFIG_DIR, "groups.json")) || { groups: [] };
  const group = config.groups.find((g) => g.slug === slug);
  if (!group) return res.status(404).json({ error: "Group not found" });

  // Count messages for this group
  let messageCount = 0;
  let lastMessageDate = null;
  try {
    const lines = fs.readFileSync(INDEX_FILE, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.from === group.jid) {
          messageCount++;
          if (!lastMessageDate || msg.date > lastMessageDate) lastMessageDate = msg.date;
        }
      } catch { /* skip */ }
    }
  } catch { /* no index */ }

  // Count summaries
  let summaryCount = 0;
  let summaryDates = [];
  try {
    const dates = fs.readdirSync(SUMMARIES_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (const date of dates) {
      if (fs.existsSync(path.join(SUMMARIES_DIR, date, `${slug}.md`))) {
        summaryCount++;
        summaryDates.push(date);
      }
    }
    summaryDates.sort().reverse();
  } catch { /* no summaries */ }

  // Count purchases for this group
  let purchaseCount = 0;
  let purchaseTotal = 0;
  try {
    const slugDir = path.join(PURCHASES_DIR, slug);
    if (fs.existsSync(slugDir)) {
      const files = fs.readdirSync(slugDir).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        const data = readJSON(path.join(slugDir, f));
        if (data) {
          purchaseCount += data.length;
          purchaseTotal += data.reduce((sum, p) => sum + (p.amount || 0), 0);
        }
      }
    }
  } catch { /* no purchases */ }

  res.json({
    messageCount,
    lastMessageDate,
    summaryCount,
    summaryDates,
    purchaseCount,
    purchaseTotal,
    currency: group.currency || "USD",
  });
});

// --- Summaries (per-group) ---

router.get("/groups/:slug/summaries", (req, res) => {
  const slug = req.params.slug;
  const summaries = [];
  try {
    const dates = fs
      .readdirSync(SUMMARIES_DIR)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();
    for (const date of dates) {
      const file = path.join(SUMMARIES_DIR, date, `${slug}.md`);
      if (fs.existsSync(file)) {
        summaries.push({
          date,
          content: fs.readFileSync(file, "utf-8"),
        });
      }
    }
  } catch { /* no summaries */ }
  res.json(summaries);
});

router.get("/groups/:slug/summaries/:date", (req, res) => {
  const file = path.join(SUMMARIES_DIR, req.params.date, `${req.params.slug}.md`);
  try {
    const content = fs.readFileSync(file, "utf-8");
    res.json({ slug: req.params.slug, date: req.params.date, content });
  } catch {
    res.status(404).json({ error: "Summary not found" });
  }
});

// --- Purchases (per-group) ---
// Structure: data/purchases/{slug}/{date}.json

router.get("/groups/:slug/purchases", (req, res) => {
  const slug = req.params.slug;
  const { from, to } = req.query;
  const purchases = [];
  const slugDir = path.join(PURCHASES_DIR, slug);

  try {
    if (!fs.existsSync(slugDir)) return res.json([]);
    const files = fs.readdirSync(slugDir).filter((f) => f.endsWith(".json")).sort().reverse();
    for (const f of files) {
      const d = f.replace(".json", "");
      if (from && d < from) continue;
      if (to && d > to) continue;
      const data = readJSON(path.join(slugDir, f));
      if (data) purchases.push(...data.map((p) => ({ ...p, _file: d })));
    }
  } catch { /* no purchases */ }

  res.json(purchases);
});

router.get("/groups/:slug/purchases/totals", (req, res) => {
  const slug = req.params.slug;
  const { from, to } = req.query;
  const purchases = [];
  const slugDir = path.join(PURCHASES_DIR, slug);

  try {
    if (!fs.existsSync(slugDir)) {
      return res.json({ totalItems: 0, totalAmount: 0, byPerson: {}, currency: "USD" });
    }
    const files = fs.readdirSync(slugDir).filter((f) => f.endsWith(".json")).sort();
    for (const f of files) {
      const d = f.replace(".json", "");
      if (from && d < from) continue;
      if (to && d > to) continue;
      const data = readJSON(path.join(slugDir, f));
      if (data) purchases.push(...data);
    }
  } catch { /* no purchases */ }

  const config = readJSON(path.join(CONFIG_DIR, "groups.json")) || { groups: [] };
  const group = config.groups.find((g) => g.slug === slug);

  const byPerson = {};
  for (const p of purchases) {
    const payer = p.paidBy || "unknown";
    if (!byPerson[payer]) byPerson[payer] = 0;
    byPerson[payer] += p.amount || 0;
  }

  res.json({
    totalItems: purchases.length,
    totalAmount: purchases.reduce((sum, p) => sum + (p.amount || 0), 0),
    byPerson,
    currency: group?.currency || "USD",
  });
});

// --- Summaries (global, for backward compat) ---

router.get("/summaries/dates", (req, res) => {
  try {
    const dates = fs
      .readdirSync(SUMMARIES_DIR)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();
    res.json(dates);
  } catch {
    res.json([]);
  }
});

// --- Settings ---

router.get("/settings", (req, res) => {
  const settings = readJSON(path.join(CONFIG_DIR, "settings.json")) || {};
  res.json(settings);
});

router.put("/settings", (req, res) => {
  const file = path.join(CONFIG_DIR, "settings.json");
  const current = readJSON(file) || {};
  const updated = { ...current, ...req.body };
  writeJSON(file, updated);
  res.json(updated);
});

// --- Pipeline ---

let pipelineProcess = null;
let pipelineLog = "";

router.post("/pipeline/run", (req, res) => {
  const date = req.query.date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  if (pipelineProcess) {
    return res.status(409).json({ error: "Pipeline is already running" });
  }

  pipelineLog = "";
  const scriptPath = path.join(PROJECT_DIR, "scripts", "daily-pipeline.sh");
  pipelineProcess = spawn("bash", [scriptPath, date], {
    cwd: PROJECT_DIR,
    env: { ...process.env },
  });

  pipelineProcess.stdout.on("data", (data) => {
    pipelineLog += data.toString();
  });
  pipelineProcess.stderr.on("data", (data) => {
    pipelineLog += data.toString();
  });
  pipelineProcess.on("close", () => {
    pipelineProcess = null;
  });

  res.json({ status: "started", date });
});

router.get("/pipeline/status", (req, res) => {
  res.json({
    running: pipelineProcess !== null,
    log: pipelineLog,
  });
});

// --- All Chats (groups + DMs) from index ---

router.get("/chats", (req, res) => {
  const msgs = readIndex();
  const chats = new Map();

  for (const msg of msgs) {
    const jid = msg.from;
    if (!chats.has(jid)) {
      // For DMs, collect the other person's name (not "me")
      const displayName = msg.isGroup
        ? msg.groupName || null
        : (!msg.fromMe ? msg.pushName : null);
      chats.set(jid, {
        jid,
        isGroup: msg.isGroup,
        name: displayName,
        messageCount: 0,
        lastTimestamp: 0,
        lastDate: null,
      });
    }
    const chat = chats.get(jid);
    chat.messageCount++;
    // Keep updating name with latest non-null value
    if (msg.isGroup && msg.groupName) chat.name = msg.groupName;
    if (!msg.isGroup && !msg.fromMe && msg.pushName) chat.name = msg.pushName;
    if (msg.timestamp > chat.lastTimestamp) {
      chat.lastTimestamp = msg.timestamp;
      chat.lastDate = msg.date;
    }
  }

  // Attach config slug if this chat is configured
  const config = readJSON(path.join(CONFIG_DIR, "groups.json")) || { groups: [] };
  const result = [...chats.values()].map((c) => {
    const group = config.groups.find((g) => g.jid === c.jid);
    return { ...c, slug: group?.slug || null, configured: !!group, active: group?.active || false, template: group?.template || null };
  });

  result.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  res.json(result);
});

// --- Messages for a chat ---

router.get("/chats/:jid/messages", (req, res) => {
  const jid = req.params.jid;
  const { date, limit: limitStr } = req.query;
  const limit = parseInt(limitStr) || 200;

  const msgs = readIndex()
    .filter((m) => m.from === jid)
    .filter((m) => !date || m.date?.startsWith(date));

  // Sort chronologically
  msgs.sort((a, b) => a.timestamp - b.timestamp);

  // Take last N
  const sliced = msgs.slice(-limit);

  // Enrich with media URL
  const enriched = sliced.map((m) => ({
    id: m.id,
    fromMe: m.fromMe,
    pushName: m.pushName,
    participant: m.participant,
    timestamp: m.timestamp,
    date: m.date,
    text: m.text,
    mediaType: m.mediaType,
    mediaPath: m.mediaPath,
    mediaMimetype: m.mediaMimetype,
    // Client can use /media/{filename} to access the file
    mediaUrl: m.mediaPath ? `/${m.mediaPath}` : null,
  }));

  res.json(enriched);
});

// --- Messages dates for a chat ---

router.get("/chats/:jid/dates", (req, res) => {
  const jid = req.params.jid;
  const msgs = readIndex().filter((m) => m.from === jid);
  const dates = [...new Set(msgs.map((m) => m.date?.slice(0, 10)).filter(Boolean))];
  dates.sort().reverse();
  res.json(dates);
});

// --- Detected unconfigured groups ---

router.get("/detected-groups", (req, res) => {
  const config = readJSON(path.join(CONFIG_DIR, "groups.json")) || { groups: [] };
  const configuredJids = new Set(config.groups.map((g) => g.jid));
  const msgs = readIndex();
  const groupJids = new Map();

  for (const msg of msgs) {
    if (msg.isGroup && !configuredJids.has(msg.from)) {
      if (!groupJids.has(msg.from)) {
        groupJids.set(msg.from, { jid: msg.from, groupName: msg.groupName, messageCount: 0 });
      }
      const g = groupJids.get(msg.from);
      g.messageCount++;
      if (msg.groupName) g.groupName = msg.groupName;
    }
  }

  res.json([...groupJids.values()]);
});

// --- Resolve real name for a configured group from index ---

router.get("/groups/:slug/resolve-name", (req, res) => {
  const config = readJSON(path.join(CONFIG_DIR, "groups.json")) || { groups: [] };
  const group = config.groups.find((g) => g.slug === req.params.slug);
  if (!group) return res.status(404).json({ error: "Group not found" });

  const msgs = readIndex();
  let realName = null;
  for (const m of msgs) {
    if (m.from === group.jid && m.groupName) { realName = m.groupName; }
    if (m.from === group.jid && !m.isGroup && !m.fromMe && m.pushName) { realName = m.pushName; }
  }

  res.json({ slug: group.slug, displayName: group.displayName, realName });
});

export default router;
