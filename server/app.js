#!/usr/bin/env node
import express from "express";
import path from "node:path";
import fs from "node:fs";
import apiRouter from "./routes/api.js";

const PROJECT_DIR = path.join(import.meta.dirname, "..");
const settingsFile = path.join(PROJECT_DIR, "config", "settings.json");

let port = 3456;
try {
  const settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
  port = settings.serverPort || 3456;
} catch {
  // use default
}

const app = express();
app.use(express.json());
app.use("/api", apiRouter);
app.use("/media", express.static(path.join(PROJECT_DIR, "media")));
app.use(express.static(path.join(import.meta.dirname, "public")));

app.listen(port, () => {
  console.log(`WA-Logger Dashboard: http://localhost:${port}`);
});
