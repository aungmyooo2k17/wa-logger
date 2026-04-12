#!/usr/bin/env node
// Extracts JSON purchase data from a markdown summary (reads stdin).
// Looks for ```json fenced blocks and outputs the parsed array.
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
let inJson = false;
const jsonLines = [];

for await (const line of rl) {
  if (line.trim().startsWith("```json")) {
    inJson = true;
    continue;
  }
  if (line.trim() === "```" && inJson) {
    inJson = false;
    continue;
  }
  if (inJson) jsonLines.push(line);
}

const raw = jsonLines.join("\n").trim();
if (raw) {
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) {
      process.stdout.write(JSON.stringify(arr));
    }
  } catch {
    // invalid JSON, skip
  }
}
