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
    assert.equal(first.cases.length, 2, 'one fixture, two explicitly separated plan modes');
    assert.deepEqual(first.cases.map(item => item.planMode), ['frozen', 'rebuilt']);
    const row = first.cases[0];
    assert.equal(row.id, 'D06');
    assert.equal(row.fetchedCount, 25);
    assert.ok(row.fixtureReads > 0, 'fixture must actually be consumed');
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/d06-plan.json', import.meta.url), 'utf8'));
    assert.deepEqual(row.queryPlan, fixture.plan, 'complete frozen plan must survive unchanged');
    assert.equal('admittedCount' in row, false);
    for (const item of first.cases) {
      assert.equal(item.formalAttentionCount, item.formalItems.length);
      assert.equal(item.libraryCount, item.libraryItems.length);
      assert.equal(item.returnedCardCount, item.formalAttentionCount + item.libraryCount);
      assert.equal(item.possibleRelatedCount, item.possibleRelated.length);
      assert.equal(item.outsideWindowReturnedCardCount, item.outsideWindowReturnedCardIds.length);
      assert.ok(Number.isInteger(item.retrievedCount));
      assert.equal(item.entries.length, 25);
      assert.equal(new Set(item.entries.map(entry => entry.entryId)).size, 25);
      assert.ok(item.formalAttentionCount > 0 || item.zeroDisplayReason);
      assert.ok(item.fixtureReads > 0, 'each mode must consume the real frozen feed');
    }
    assert.match(readFileSync(join(directory, 'results.md'), 'utf8'), /资料库.*可能相关.*窗口外进入返回卡片数/);
    assert.match(readFileSync(join(directory, 'results.md'), 'utf8'), /D06/);
    assert.match(first.limitations, /人工/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
