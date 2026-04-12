#!/usr/bin/env node
// Reads active groups from config and outputs pipe-delimited lines.
// Usage: node read-groups.js /path/to/groups.json
import fs from "node:fs";

const configFile = process.argv[2];
if (!configFile) {
  console.error("Usage: node read-groups.js <groups.json path>");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));
const active = config.groups.filter((g) => g.active);

for (const g of active) {
  const participants =
    Object.values(g.participants || {}).join(", ") || "unknown";
  console.log(
    [
      g.jid,
      g.slug,
      g.displayName,
      g.template,
      g.language || "en",
      g.currency || "USD",
      participants,
    ].join("|")
  );
}
