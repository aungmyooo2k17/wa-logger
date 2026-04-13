#!/usr/bin/env node
// Wrapper script: auto-discover groups, then start the bot

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.dirname(__dirname);

console.log("[start] Auto-discovering groups...");
try {
  execSync(`node "${__dirname}/auto-discover-groups.js"`, { stdio: "inherit" });
} catch (err) {
  console.error("[start] Auto-discovery failed:", err.message);
  // Continue anyway, don't block startup
}

console.log("[start] Starting bot...");
execSync(`node "${PROJECT_DIR}/index.js"`, { stdio: "inherit" });
