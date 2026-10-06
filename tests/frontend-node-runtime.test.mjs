import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfigFromFile } from 'vite';

async function withRuntime(runtime, operation) {
  const names = ['SIGNAL_MAP_FRONTEND_RUNTIME', 'WRANGLER_WRITE_LOGS', 'WRANGLER_LOG_PATH', 'MINIFLARE_REGISTRY_PATH'];
  const previous = names.map((name) => process.env[name]);
  if (runtime === undefined) delete process.env.SIGNAL_MAP_FRONTEND_RUNTIME;
  else process.env.SIGNAL_MAP_FRONTEND_RUNTIME = runtime;
  try {
    return await operation();
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
}

async function pluginNames() {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' });
  assert.ok(loaded);
  const names = [];
  async function visit(option) {
    const resolved = await option;
    if (Array.isArray(resolved)) for (const item of resolved) await visit(item);
    else if (resolved) names.push(resolved.name);
  }
  await visit(loaded.config.plugins);
  return names;
}

test('Node config uses native vinext without Sites or Cloudflare runtime plugins', async () => {
  await withRuntime('node', async () => {
    const before = process.env.WRANGLER_LOG_PATH;
    const names = await pluginNames();
    assert.ok(names.some((name) => name.includes('vinext')));
    // vinext's own cloudflare-build hook is always installed, but is inert
    // without the external Cloudflare runtime plugin.
    assert.deepEqual(names.filter((name) => /^vite-plugin-cloudflare/.test(name) || name === 'sites'), []);
    assert.equal(process.env.WRANGLER_LOG_PATH, before);
  });
});

test('default build retains the existing Cloudflare plugin', async () => {
  await withRuntime(undefined, async () => {
    const names = await pluginNames();
    assert.ok(names.some((name) => name.includes('cloudflare')));
  });
});

test('unknown frontend runtime fails rather than silently building another target', async () => {
  await withRuntime('invalid-target', async () => {
    await assert.rejects(pluginNames, /Unsupported frontend runtime/);
  });
});
