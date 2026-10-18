import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Use the locked framework CLI, not next start or a custom SSR implementation.
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/vinext/dist/cli.js', import.meta.url));
const command = process.argv[2];
if (command !== 'build' && command !== 'start') {
  throw new Error('Usage: node scripts/frontend-node.mjs build|start');
}
const args = [cli, command];
if (command === 'start') {
  if (!existsSync(new URL('../dist/server/index.js', import.meta.url)) ||
      !existsSync(new URL('../dist/client', import.meta.url))) {
    throw new Error('Frontend artifact missing; run npm run build:node first');
  }
  const port = process.env.PORT ?? '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  args.push('--port', port, '--hostname', process.env.HOST ?? '127.0.0.1');
}
const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SIGNAL_MAP_FRONTEND_RUNTIME: 'node' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
