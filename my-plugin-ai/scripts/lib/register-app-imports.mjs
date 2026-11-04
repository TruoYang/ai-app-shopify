// Lets plain Node scripts import app/*.server.js modules, which use extensionless
// relative imports (resolved by Vite inside the app). Usage:
//   node --import ./scripts/lib/register-app-imports.mjs scripts/...
import { register } from "node:module";

register("./ext-hook.mjs", import.meta.url);
