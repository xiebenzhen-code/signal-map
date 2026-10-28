import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('frozen evaluation replays real fixtures deterministically without external requests', () => {
  const directory = mkdtempSync(join(tmpdir(), 'signal-map-eval-'));
  try {
    const replay = () => {
      const child = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/eval-frozen.mjs', '--output-dir', directory],
        { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30000 });
      assert.equal(child.status, 0, child.stderr || child.stdout);
      return JSON.parse(readFileSync(join(directory, 'results.json'), 'utf8'));
    };
    const first = replay();
    assert.deepEqual(replay(), first, 'same frozen input and clock must reproduce results');
    assert.equal(first.networkRequests, 0);
    assert.equal(first.modelCalls, 0);
    assert.equal(first.cases.length, 1, 'only one complete frozen feed/question pair exists');
    const row = first.cases[0];
    assert.equal(row.id, 'D06');
    assert.equal(row.fetchedCount, 25);
    assert.ok(row.fixtureReads > 0, 'fixture must actually be consumed');
    assert.equal(row.displayedCount, row.formalItems.length);
    assert.equal(row.possibleRelatedCount, row.possibleRelated.length);
    assert.equal(row.outsideWindowEnteredFormal, false);
    assert.ok(row.displayedCount > 0 || row.zeroDisplayReason);
    assert.match(readFileSync(join(directory, 'results.md'), 'utf8'), /D06/);
    assert.match(first.limitations, /人工/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
