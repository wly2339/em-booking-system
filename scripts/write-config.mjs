import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const configPath = join(root, "public", "config.js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY.");
  console.error("Set them in Cloudflare Pages > Settings > Environment variables.");
  process.exit(1);
}

const config = `window.EM_BOOKING_CONFIG = ${JSON.stringify(
  {
    supabaseUrl,
    supabaseAnonKey
  },
  null,
  2
)};\n`;

await writeFile(configPath, config, "utf8");
console.log(`Wrote ${configPath}`);
