#!/usr/bin/env node
// Auto-discovers all groups from messages.json and updates config/groups.json with defaults
// Runs before bot startup to ensure all groups are configured

import fs from "node:fs";
import path from "node:path";

const PROJECT_DIR = path.join(import.meta.dirname, "..");
const MESSAGES_FILE = path.join(PROJECT_DIR, "messages.json");
const GROUPS_FILE = path.join(PROJECT_DIR, "config", "groups.json");

// Default group config
const defaultGroupConfig = {
  active: true,
  template: "business-summary",
  language: "en",
  currency: "SGD",
  features: {
    expenseTracking: true,
    receiptOCR: true,
    audioTranscription: true,
  },
  participants: {},
};

// Social group config (for non-business groups)
const socialGroupConfig = {
  active: true,
  template: "social-highlights",
  language: "en",
  currency: "SGD",
  features: {
    expenseTracking: false,
    receiptOCR: false,
    audioTranscription: true,
  },
  participants: {},
};

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50);
}

function discoverGroups() {
  if (!fs.existsSync(MESSAGES_FILE)) {
    console.log("[auto-discover-groups] No messages.json found. Skipping.");
    return;
  }

  try {
    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf-8"));

    // Extract unique groups
    const groupsMap = new Map();
    for (const msg of messages) {
      if (msg.isGroup && msg.groupName && msg.from) {
        if (!groupsMap.has(msg.from)) {
          groupsMap.set(msg.from, msg.groupName);
        }
      }
    }

    if (groupsMap.size === 0) {
      console.log("[auto-discover-groups] No groups found in messages.");
      return;
    }

    // Load existing config
    let existingConfig = { groups: [] };
    if (fs.existsSync(GROUPS_FILE)) {
      try {
        existingConfig = JSON.parse(fs.readFileSync(GROUPS_FILE, "utf-8"));
      } catch {
        console.warn("[auto-discover-groups] Failed to parse existing config, starting fresh.");
      }
    }

    // Create map of existing groups by JID
    const existingJids = new Set(existingConfig.groups.map((g) => g.jid));

    // Add new groups
    let added = 0;
    for (const [jid, groupName] of groupsMap) {
      if (!existingJids.has(jid)) {
        const isSocialGroup = groupName.includes("Myanmar") || groupName.includes("Club");
        const config = isSocialGroup ? { ...socialGroupConfig } : { ...defaultGroupConfig };

        existingConfig.groups.push({
          jid,
          slug: slugify(groupName),
          displayName: groupName,
          ...config,
        });
        added++;
      }
    }

    // Save updated config
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(existingConfig, null, 2), "utf-8");
    console.log(`[auto-discover-groups] Auto-discovered ${groupsMap.size} total groups. Added ${added} new groups.`);

  } catch (err) {
    console.error("[auto-discover-groups] Error:", err.message);
  }
}

discoverGroups();
