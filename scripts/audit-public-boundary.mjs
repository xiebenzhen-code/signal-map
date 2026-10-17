import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Compare credential values in memory; never print them or their hashes.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
const secrets = Object.entries(process.env)
  .filter(([name, value]) => !name.startsWith("NEXT_PUBLIC_") && /DATABASE_URL|API_KEY|SERVICE_ROLE|SECRET|TOKEN|PASSWORD/.test(name) && value?.length >= 16)
  .map(([, value]) => value);
const ignored = new Set(["node_modules", ".git", ".agents", ".netlify", ".wrangler", ".vinext", ".next", ".codex"]);
let scanned = 0;
let credentialMatches = 0;
let clientBoundaryMatches = 0;
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith(".env")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { scan(path); continue; }
    if (!/\.(ts|tsx|js|mjs|cjs|json|map|sql|log|md)$/.test(entry.name)) continue;
    const text = readFileSync(path, "utf8");
    scanned += 1;
    if (secrets.some((value) => text.includes(value))) credentialMatches += 1;
    if (/dist[/\\]client[/\\]/.test(path) && /DATABASE_URL|DEEPSEEK_API_KEY|OPENAI_API_KEY|sb_secret_/.test(text)) clientBoundaryMatches += 1;
  }
}
scan(".");
const artifactsPresent = existsSync("dist/client") && existsSync("dist/server/index.js") && existsSync("dist-api/server.mjs");
console.log(JSON.stringify({ artifactsPresent, scannedFiles: scanned, configuredSecretsChecked: secrets.length, credentialMatchFiles: credentialMatches, clientBoundaryMatchFiles: clientBoundaryMatches }));
if (!artifactsPresent || credentialMatches || clientBoundaryMatches) process.exitCode = 1;
