/* eslint-env node */
// Render the system flow diagrams (docs/flows/src/{en,vi}/*.mmd) to PNG for the report.
//
// Output: docs/flows/img/<name>.png (English) and docs/flows/img/<name>.vi.png (Vietnamese).
// Uses the locally installed Chrome or Edge instead of downloading a browser; set
// CHROME_PATH to use another one.
//
// Usage (from my-plugin-ai/): npm run docs:diagrams

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const SRC = path.join("docs", "flows", "src");
const OUT = path.join("docs", "flows", "img");
const BROWSERS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const browser = BROWSERS.find((candidate) => fs.existsSync(candidate));
if (!browser) throw new Error("No Chrome/Edge found; set CHROME_PATH");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mmdc-"));
const puppeteerConfig = path.join(tmp, "puppeteer.json");
fs.writeFileSync(puppeteerConfig, JSON.stringify({ executablePath: browser, args: ["--no-sandbox"] }));
const mermaidConfig = path.join(tmp, "mermaid.json");
fs.writeFileSync(mermaidConfig, JSON.stringify({
  theme: "neutral",
  themeVariables: { fontFamily: "Segoe UI, Arial, sans-serif", fontSize: "16px" },
  flowchart: { htmlLabels: true, curve: "basis" },
}));

const mmdc = path.join("node_modules", ".bin", process.platform === "win32" ? "mmdc.cmd" : "mmdc");
fs.mkdirSync(OUT, { recursive: true });

for (const language of ["en", "vi"]) {
  for (const file of fs.readdirSync(path.join(SRC, language)).filter((name) => name.endsWith(".mmd"))) {
    const name = path.basename(file, ".mmd");
    const output = path.join(OUT, language === "en" ? `${name}.png` : `${name}.vi.png`);
    execFileSync(mmdc, [
      "-i", path.join(SRC, language, file),
      "-o", output,
      "-p", puppeteerConfig,
      "-c", mermaidConfig,
      "-b", "white",
      "-s", "2",
    ], { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
    console.log(`  ${output}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
