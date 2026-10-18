import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { resolveConfig } from 'vite';

const require = createRequire(import.meta.url);
const packageOf = name => JSON.parse(fs.readFileSync(require.resolve(`${name}/package.json`), 'utf8'));

// GHSA-wx67-qw84-cm4g fixes the reviewed 19.2 release line at 19.2.8.
// A new release line requires a fresh security/compatibility review.
test('the production RSC plugin selects a patched top-level implementation', async () => {
  const previous = process.env.SIGNAL_MAP_FRONTEND_RUNTIME;
  process.env.SIGNAL_MAP_FRONTEND_RUNTIME = 'node';
  try {
    const config = await resolveConfig({}, 'build', 'production');
    const clientIncludes = config.environments.client.optimizeDeps.include;
    assert.ok(clientIncludes.includes('react-server-dom-webpack/client.browser'),
      'RSC client must resolve the reviewed top-level package, not a vendored fallback');
    const resolved = packageOf('react-server-dom-webpack');
    const match = /^19\.2\.(\d+)$/.exec(resolved.version);
    assert.ok(match && Number(match[1]) >= 8,
      `Selected RSC implementation ${resolved.version} is outside the reviewed patched 19.2 range`);
  } finally {
    if (previous === undefined) delete process.env.SIGNAL_MAP_FRONTEND_RUNTIME;
    else process.env.SIGNAL_MAP_FRONTEND_RUNTIME = previous;
  }
});

test('installed React and DOM satisfy the selected RSC release peer contract', () => {
  const rsc = packageOf('react-server-dom-webpack');
  const react = packageOf('react');
  const dom = packageOf('react-dom');
  assert.equal(react.version, rsc.version);
  assert.equal(dom.version, rsc.version);
  assert.equal(rsc.peerDependencies.react, `^${react.version}`);
  assert.equal(rsc.peerDependencies['react-dom'], `^${dom.version}`);
  assert.equal(dom.peerDependencies.react, `^${react.version}`);
});
