#!/usr/bin/env node
// Pre-processes media files for a given date.
// Audio → Whisper STT, Images → Ollama vision, PDFs → text extraction
// Usage: node process-media.js YYYY-MM-DD
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const PROJECT_DIR = path.join(import.meta.dirname, "..");
const INDEX_FILE = path.join(PROJECT_DIR, "data", "message-index.jsonl");
const TRANSCRIPTS_DIR = path.join(PROJECT_DIR, "data", "transcripts");
const SETTINGS_FILE = path.join(PROJECT_DIR, "config", "settings.json");
const GROUPS_FILE = path.join(PROJECT_DIR, "config", "groups.json");

const targetDate = process.argv[2];
if (!targetDate) {
  console.error("Usage: node process-media.js YYYY-MM-DD");
  process.exit(1);
}

// Load settings
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
} catch {
  console.warn("[process-media] No settings.json found, using defaults.");
}

// Load group config
let groupConfig = { groups: [] };
try {
  groupConfig = JSON.parse(fs.readFileSync(GROUPS_FILE, "utf-8"));
} catch {
  // no config
}

const activeJids = new Set(
  groupConfig.groups.filter((g) => g.active).map((g) => g.jid)
);

function getGroupFeatures(jid) {
  const group = groupConfig.groups.find((g) => g.jid === jid);
  return group?.features || {};
}

// Create output directory
const dayDir = path.join(TRANSCRIPTS_DIR, targetDate);
fs.mkdirSync(dayDir, { recursive: true });

// Read messages for the target date
const lines = fs.readFileSync(INDEX_FILE, "utf-8").split("\n").filter(Boolean);
const messages = lines
  .map((line) => { try { return JSON.parse(line); } catch { return null; } })
  .filter(Boolean)
  .filter((m) => m.date?.startsWith(targetDate))
  .filter((m) => m.mediaPath && m.mediaMimetype);

console.log(`[process-media] Date: ${targetDate}`);
console.log(`[process-media] Found ${messages.length} media messages`);

let processed = 0;
let skipped = 0;
let errors = 0;

for (const msg of messages) {
  const outFile = path.join(dayDir, `${msg.id}.txt`);

  // Skip if already processed (idempotent)
  if (fs.existsSync(outFile)) {
    skipped++;
    continue;
  }

  // Only process media for active groups (or 1-on-1 chats)
  if (msg.isGroup && !activeJids.has(msg.from)) {
    skipped++;
    continue;
  }

  const features = msg.isGroup ? getGroupFeatures(msg.from) : {
    audioTranscription: true,
    receiptOCR: true,
  };

  const mediaPath = path.join(PROJECT_DIR, msg.mediaPath);
  if (!fs.existsSync(mediaPath)) {
    console.warn(`[process-media] File not found: ${msg.mediaPath}`);
    errors++;
    continue;
  }

  const mime = msg.mediaMimetype;

  try {
    if (mime.startsWith("audio/") && features.audioTranscription !== false) {
      processAudio(mediaPath, outFile, msg.id);
      processed++;
    } else if (mime.startsWith("image/")) {
      processImage(mediaPath, outFile, msg.id, features.receiptOCR);
      processed++;
    } else if (mime === "application/pdf") {
      await processPDF(mediaPath, outFile, msg.id);
      processed++;
    } else {
      // Skip unsupported types (video, zip, docx, stickers)
      skipped++;
    }
  } catch (err) {
    console.error(`[process-media] Error processing ${msg.id}: ${err.message}`);
    errors++;
  }
}

console.log(`[process-media] Done. Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`);

// --- Processors ---

function processAudio(filePath, outFile, msgId) {
  const model = settings.whisperModel || "base";
  const extraArgs = settings.whisperExtraArgs || "--output_format txt";

  // Check if docker is available
  try {
    execSync("docker --version", { stdio: "pipe" });
  } catch {
    console.warn(`[process-media] Docker not found. Skipping audio ${msgId}. Install: brew install docker`);
    return;
  }

  console.log(`[process-media] Transcribing audio: ${msgId}`);
  const tmpDir = path.join(PROJECT_DIR, "data", ".tmp-whisper");
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const fileName = path.basename(filePath);
    const mediaDir = path.dirname(filePath);

    // Run Whisper via Docker
    execSync(
      `docker run --rm -v "${mediaDir}:/media" wa-whisper "/media/${fileName}" --model ${model} ${extraArgs} --output_dir /media`,
      { stdio: "pipe", timeout: 300000 }
    );

    // Whisper outputs {filename}.txt in the output dir
    const baseName = path.basename(filePath, path.extname(filePath));
    const whisperOut = path.join(mediaDir, `${baseName}.txt`);
    if (fs.existsSync(whisperOut)) {
      fs.copyFileSync(whisperOut, outFile);
      fs.unlinkSync(whisperOut);
      console.log(`[process-media] Audio transcribed: ${msgId}`);
    }
  } catch (err) {
    console.warn(`[process-media] Docker Whisper failed for ${msgId}: ${err.message}`);
    console.warn(`[process-media] Ensure image is built: docker build -f Dockerfile.whisper -t wa-whisper .`);
  } finally {
    // Clean up tmp dir
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
}

function processImage(filePath, outFile, msgId, receiptOCR) {
  const imageBase64 = fs.readFileSync(filePath).toString("base64");

  const prompt = receiptOCR
    ? "Describe this image. If it contains a receipt, invoice, or price list, extract all items, prices, and totals in a structured format. If it contains text in any language, transcribe it."
    : "Briefly describe what this image shows.";

  console.log(`[process-media] Analyzing image: ${msgId}`);

  try {
    // Use Claude via CLI (haiku = cheapest model)
    const result = execSync(
      `claude -p --model haiku`,
      {
        input: `[image: data:image/png;base64,${imageBase64}]\n\n${prompt}`,
        timeout: 120000,
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    const output = result.toString().trim();
    if (output) {
      fs.writeFileSync(outFile, output, "utf-8");
      console.log(`[process-media] Image analyzed: ${msgId}`);
    }
  } catch (err) {
    console.warn(`[process-media] Claude image analysis failed for ${msgId}: ${err.message}`);
  }
}

async function processPDF(filePath, outFile, msgId) {
  console.log(`[process-media] Extracting PDF text: ${msgId}`);

  try {
    const { PDFParse } = await import("pdf-parse");
    const buffer = new Uint8Array(fs.readFileSync(filePath));
    const pdf = new PDFParse(buffer, {});
    await pdf.load();
    const result = await pdf.getText();
    // result.text contains all pages, result.pages has per-page text
    const text = result.pages
      ?.map((p) => p.text?.trim())
      .filter(Boolean)
      .join("\n\n");
    if (text) {
      fs.writeFileSync(outFile, text, "utf-8");
      console.log(`[process-media] PDF extracted: ${msgId} (${result.total} pages)`);
    } else {
      // Image-based PDF -- will be handled by vision model if available
      console.log(`[process-media] PDF has no extractable text (scanned?): ${msgId}`);
    }
  } catch (err) {
    console.warn(`[process-media] PDF extraction failed for ${msgId}: ${err.message}`);
  }
}
