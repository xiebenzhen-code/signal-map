import { cp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const distDir = join(projectRoot, "dist");
const clientDir = join(distDir, "client");
const indexHtmlPath = join(distDir, "index.html");
const renderPort = process.env.EDGEONE_RENDER_PORT ?? "31073";
const localUrl = `http://127.0.0.1:${renderPort}/`;
const vinextCli = join(projectRoot, "node_modules", "vinext", "dist", "cli.js");

async function fetchHtml() {
  const response = await fetch(localUrl);
  if (!response.ok) {
    throw new Error(`Local render returned HTTP ${response.status}`);
  }
  const html = await response.text();
  if (!html.includes("<!DOCTYPE html")) {
    throw new Error("Local render did not return an HTML document.");
  }
  return html;
}

async function waitForHtml(timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchHtml();
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
  }

  throw lastError ?? new Error("Timed out waiting for local render.");
}

async function renderIndexHtml() {
  const child = spawn(process.execPath, [vinextCli, "start"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: renderPort },
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    return await waitForHtml();
  } finally {
    child.kill();
  }
}

function referencedRootAssets(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((asset) => asset.startsWith("/_next/") || asset.startsWith("/favicon") || asset.startsWith("/og"))
    .map((asset) => asset.replace(/^\//, ""));
}

async function main() {
  if (!existsSync(clientDir)) {
    throw new Error("dist/client does not exist. Run npm run build first.");
  }

  const html = await renderIndexHtml();
  await writeFile(indexHtmlPath, html, "utf8");
  await cp(clientDir, distDir, { recursive: true, force: true });

  const refreshedHtml = await readFile(indexHtmlPath, "utf8");
  const missingAssets = referencedRootAssets(refreshedHtml).filter((asset) => !existsSync(join(distDir, asset)));

  if (missingAssets.length > 0) {
    throw new Error(`Missing referenced assets: ${missingAssets.join(", ")}`);
  }

  console.log(`EdgeOne Drop package root is ready: ${distDir}`);
  console.log("ZIP the contents of dist, not the dist folder itself.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
