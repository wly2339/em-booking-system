import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const configPath = join(root, "public", "config.js");

const cloudbaseEnvId = process.env.CLOUDBASE_ENV_ID;
const cloudbasePublishableKey = process.env.CLOUDBASE_PUBLISHABLE_KEY;
const cloudbaseRegion = process.env.CLOUDBASE_REGION ?? "ap-shanghai";

if (!cloudbaseEnvId || !cloudbasePublishableKey) {
  console.error("Missing CLOUDBASE_ENV_ID or CLOUDBASE_PUBLISHABLE_KEY.");
  process.exit(1);
}

const config = `window.EM_BOOKING_CONFIG = ${JSON.stringify(
  {
    cloudbaseEnvId,
    cloudbaseRegion,
    cloudbasePublishableKey
  },
  null,
  2
)};\n`;

await writeFile(configPath, config, "utf8");
console.log(`Wrote ${configPath}`);
