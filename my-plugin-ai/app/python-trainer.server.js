// Runs ml/train.py for the algorithms implemented in Python (FP-Growth, item-kNN, DEC).
// The interpreter is ML_PYTHON, or the project's virtualenv in ml/.venv.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const PYTHON_STRATEGIES = ["fpgrowth", "itemknn", "dec", "hybrid"];
const TIMEOUT_MS = 15 * 60_000;

export function pythonBinary() {
  if (process.env.ML_PYTHON) return process.env.ML_PYTHON;
  const venv = process.platform === "win32"
    ? path.join(process.cwd(), "ml", ".venv", "Scripts", "python.exe")
    : path.join(process.cwd(), "ml", ".venv", "bin", "python");
  return fs.existsSync(venv) ? venv : null;
}

/**
 * Trains `algorithm` on dataset ({ orders: [{ id, date, items }] }) and returns
 * { rules: [{ cart, suggest, confidence, support, score }], fitSeconds }.
 * Throws when Python is missing or the run fails, so the caller can fall back.
 */
export async function trainWithPython(dataset, algorithm) {
  const python = pythonBinary();
  if (!python) throw new Error("Python environment not found (set ML_PYTHON or create ml/.venv)");

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "smartcart-train-"));
  const input = path.join(dir, "dataset.json");
  const output = path.join(dir, "rules.json");
  await fs.promises.writeFile(input, JSON.stringify(dataset));

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(python, [
        path.join(process.cwd(), "ml", "train.py"),
        "--input", input, "--algorithm", algorithm, "--output", output,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.stdout.on("data", (chunk) => console.log(`[ml/train.py] ${String(chunk).trim()}`));
      const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ml/train.py exited with ${code}: ${stderr.trim().split("\n").slice(-3).join(" ")}`));
      });
    });
    const result = JSON.parse(await fs.promises.readFile(output, "utf8"));
    return { rules: result.rules, fitSeconds: result.fit_seconds };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
