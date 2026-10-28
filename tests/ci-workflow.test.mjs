import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('CI checks master/develop pushes and PRs with Node 24 and no secrets', () => {
  const yaml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(yaml, /push:\s*\n\s*branches: \[master, develop\]/);
  assert.match(yaml, /pull_request:\s*\n\s*branches: \[master, develop\]/);
  assert.match(yaml, /permissions:\s*\n\s*contents: read/);
  assert.match(yaml, /node-version: ['"]24['"]/);
  assert.doesNotMatch(yaml, /secrets\.|pull_request_target|continue-on-error/);
  const commands = [...yaml.matchAll(/- run: (.+)/g)].map(match => match[1]);
  assert.deepEqual(commands, ['npm ci', 'npm run quality', 'npm run build', 'npm run api:build']);
});

test('obsolete manual API image build workflow is retired', () => {
  assert.equal(existsSync(new URL('../.github/workflows/build-api-image.yml', import.meta.url)), false);
});
