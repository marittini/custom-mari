// Playwright for the Mari checks: the machine's own `playwright` when there is one (a sandbox with browsers already
// installed), else the repository's `@playwright/test` (CI, after `pnpm exec playwright install chromium`).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(new URL("../../../package.json", import.meta.url)));
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require("@playwright/test");
}
export const { chromium, devices } = pw;
