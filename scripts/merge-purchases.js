#!/usr/bin/env node
// Merges new purchase items into a daily purchases JSON file.
// Usage: node merge-purchases.js <purchases-file.json> '<json-array-string>'
import fs from "node:fs";

const purchasesFile = process.argv[2];
const newItemsJson = process.argv[3];

if (!purchasesFile || !newItemsJson) {
  process.exit(0);
}

try {
  const existing = JSON.parse(fs.readFileSync(purchasesFile, "utf-8"));
  const newItems = JSON.parse(newItemsJson);
  existing.push(...newItems);
  fs.writeFileSync(purchasesFile, JSON.stringify(existing, null, 2), "utf-8");
  console.log(
    `[generate-summary] Extracted ${newItems.length} purchase(s)`
  );
} catch {
  // skip
}
