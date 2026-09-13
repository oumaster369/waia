// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync, linkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { dependencyVitestVersion, discover, inventory, mergeBlobs, requireSuccess, validateManifest, validatePartition, validateReport, verifyShardEvidence } from '../../scripts/github/unit-shard-evidence.mjs';

const roots: string[] = [];
const temporary = () => { const root = mkdtempSync(join(tmpdir(), 'waia-dee1002-test-')); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const files = ['a.test.js', 'b.test.js'];
const discovery = { full: files, shards: [[files[0]], [files[1]]] };
const identity = { sha: 'a'.repeat(40), runId: '123', attempt: '1' };
const manifest = () => ({ identity, index: 1, count: 2, discovery, startedAt: 1 });
const report = () => ({ success: true, numFailedTests: 0, numFailedTestSuites: 0, numTotalTests: 2,
  numPassedTests: 1, numPendingTests: 1, numTodoTests: 0,
  testResults: files.map((name, i) => ({ name, status: 'passed', message: '', assertionResults: [
    { status: i === 0 ? 'passed' : 'skipped', failureMessages: [] },
  ] })) });

describe('DEE-1002 fail-closed unit shard evidence', () => {
  it('reads the exact dependency version even when pnpm hard-links its package metadata', () => {
    const root = temporary(), store = join(root, 'store-package.json');
    writeFileSync(store, '{"version":"2.1.9"}'); mkdirSync(join(root, 'node_modules/vitest'), { recursive: true });
    linkSync(store, join(root, 'node_modules/vitest/package.json'));
    expect(dependencyVitestVersion(root)).toBe('2.1.9');
  });
  it('accepts only a complete disjoint two-way inventory', () => {
    expect(() => validatePartition(files, discovery.shards)).not.toThrow();
    for (const shards of [[[files[0]], []], [[files[0]], [files[0]]], [[files[0]], [files[1], 'extra']], [files]])
      expect(() => validatePartition(files, shards)).toThrow();
    expect(() => inventory(['a', 'a'], '/root')).toThrow();
    expect(() => inventory(['../outside'], '/root')).toThrow();
    expect(() => inventory([], '/root')).toThrow();
  });
  it.each(['failure', 'cancelled', 'skipped', '', undefined])('rejects non-success shard state %s', state => {
    expect(() => requireSuccess(state)).toThrow();
  });
  it('keeps intentional skipped tests represented without counting them passed', () => {
    expect(validateReport(report(), files, '/root')).toEqual({ files: 2, passed: 1, skipped: 1, todo: 0 });
    expect(() => requireSuccess('success')).not.toThrow();
  });
  it('rejects missing, duplicate, extra or incomplete actual report files', () => {
    for (const testResults of [report().testResults.slice(0, 1), [report().testResults[0], report().testResults[0]],
      [...report().testResults, { ...report().testResults[0], name: 'extra.test.js' }]])
      expect(() => validateReport({ ...report(), testResults }, files, '/root')).toThrow();
    for (const status of ['failed', 'pending', 'unknown']) {
      const r = report(); r.testResults[0].assertionResults[0].status = status;
      expect(() => validateReport(r, files, '/root')).toThrow();
    }
    expect(() => validateReport({ ...report(), success: false }, files, '/root')).toThrow();
    expect(() => validateReport({ ...report(), numPassedTests: 2 }, files, '/root')).toThrow();
    expect(() => validateReport({}, files, '/root')).toThrow();
  });
  it('rejects stale SHA, run, attempt, index and declared coverage', () => {
    expect(() => validateManifest(manifest(), identity, 1, discovery)).not.toThrow();
    for (const changed of [{ sha: 'b'.repeat(40) }, { runId: '124' }, { attempt: '2' }])
      expect(() => validateManifest({ ...manifest(), identity: { ...identity, ...changed } }, identity, 1, discovery)).toThrow();
    expect(() => validateManifest(manifest(), identity, 2, discovery)).toThrow();
    expect(() => validateManifest({ ...manifest(), discovery: { full: files.slice(0, 1), shards: [[files[0]], []] } }, identity, 1, discovery)).toThrow();
  });
  it('binds exact artifact inventory/hashes and refuses missing, extra, stale or altered evidence', () => {
    const root = temporary(), evidence = join(root, 'evidence'); mkdirSync(join(evidence, 'merged/blobs'), { recursive: true });
    const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    const save = (path: string, value: unknown) => writeFileSync(join(evidence, path), JSON.stringify(value));
    const ownDiscovery = { full: files, shards: [files, []] };
    save('manifest.json', { ...manifest(), discovery: ownDiscovery }); save('merged/report.json', report());
    writeFileSync(join(evidence, 'blob.json'), 'synthetic-opaque-blob');
    writeFileSync(join(evidence, 'merged/blobs/0.json'), 'synthetic-opaque-blob'); writeFileSync(join(evidence, 'unit.log'), 'synthetic');
    const receipt = { identity, index: 1, outcome: 'success', manifestSha256: hash(join(evidence, 'manifest.json')),
      blobSha256: hash(join(evidence, 'blob.json')), reportSha256: hash(join(evidence, 'merged/report.json')),
      counts: { files: 2, passed: 1, skipped: 1, todo: 0 } };
    save('receipt.json', receipt);
    const check = () => verifyShardEvidence(evidence, identity, 1, ownDiscovery, root);
    expect(check()).toBe(join(evidence, 'blob.json'));
    save('extra.json', {}); expect(check).toThrow(); rmSync(join(evidence, 'extra.json'));
    for (const field of ['blobSha256', 'reportSha256', 'manifestSha256']) {
      save('receipt.json', { ...receipt, [field]: '0'.repeat(64) }); expect(check).toThrow();
    }
    save('receipt.json', { ...receipt, identity: { ...identity, attempt: '2' } }); expect(check).toThrow();
    save('receipt.json', { ...receipt, outcome: 'skipped' }); expect(check).toThrow();
    save('receipt.json', receipt); writeFileSync(join(evidence, 'blob.json'), 'altered'); expect(check).toThrow();
    rmSync(join(evidence, 'receipt.json')); expect(check).toThrow();
  });
  it('preserves required gate name/dependencies, watchdog, isolated jobs and all-fresh retry policy', () => {
    const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toMatch(/unit-shards:[\s\S]*fail-fast: false[\s\S]*shard: \[1, 2\]/);
    expect(workflow).toContain('pnpm test --run --reporter=dot --reporter=blob');
    expect(workflow).toContain('WAIA_UNIT_TIMEOUT_SECONDS=3600'); expect(workflow).toContain('timeout-minutes: 70');
    expect(workflow).toMatch(/  test:\n    name: unit tests\n    needs: \[unit-shards\]\n    if: always\(\)/);
    expect(workflow).toContain('needs: [lint, typecheck, test, tenant-isolation');
    expect(workflow).toContain('rerun ALL jobs');
    expect(workflow.indexOf('run: test "$UNIT_SHARDS_RESULT" = success')).toBeLessThan(workflow.indexOf('uses: actions/download-artifact@v4'));
  });
  it('uses actual Vitest2 native discovery/shards/blob merge, retaining skip-only and failing fixtures', async () => {
    const root = temporary(), marker = join(root, 'executed'), config = join(root, 'vitest.config.mjs');
    writeFileSync(config, `export default {test:{include:['*.test.js'],environment:'node',globals:true,fileParallelism:false,isolate:true}};`);
    writeFileSync(join(root, 'a.test.js'), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'yes');test('pass',()=>expect(1).toBe(1));`);
    writeFileSync(join(root, 'b.test.js'), `test.skip('intentional skip',()=>{});`);
    writeFileSync(join(root, 'c.test.js'), `test.todo('intentional todo');`);
    writeFileSync(join(root, 'd.test.js'), `test('another pass',()=>expect(2).toBe(2));`);
    const discovered = await discover(root, config);
    expect(existsSync(marker)).toBe(false); expect(discovered.full).toHaveLength(4);
    validatePartition(discovered.full, discovered.shards);
    const cli = resolve('node_modules/vitest/vitest.mjs'), blobs: string[] = [];
    for (const index of [1, 2]) {
      const blob = join(root, `blob-${index}.json`); blobs.push(blob);
      execFileSync(process.execPath, [cli, 'run', '--root', root, '--config', config, `--shard=${index}/2`, '--reporter=blob', `--outputFile=${blob}`],
        { cwd: root, timeout: 20000, stdio: 'pipe' });
      const actual = mergeBlobs(root, [blob], join(root, `single-${index}`), config);
      validateReport(actual, discovered.shards[index - 1], root);
    }
    expect(existsSync(marker)).toBe(true); rmSync(marker);
    const combined = mergeBlobs(root, blobs, join(root, 'combined'), config);
    expect(validateReport(combined, discovered.full, root)).toEqual({ files: 4, passed: 2, skipped: 1, todo: 1 });
    expect(existsSync(marker)).toBe(false); // Native merge must not import/execute fixtures.
    expect(() => validateReport(mergeBlobs(root, [blobs[0], blobs[0]], join(root, 'duplicate'), config), discovered.full, root)).toThrow();
    expect(() => validateReport(mergeBlobs(root, [blobs[0]], join(root, 'missing'), config), discovered.full, root)).toThrow();
    writeFileSync(join(root, 'a.test.js'), `test('failure',()=>expect(1).toBe(2));`);
    const failIndex = discovered.shards.findIndex(shard => shard.includes('a.test.js')) + 1;
    const failedBlob = join(root, 'failed.json');
    const failed = spawnSync(process.execPath, [cli, 'run', '--root', root, '--config', config, `--shard=${failIndex}/2`, '--reporter=blob', `--outputFile=${failedBlob}`],
      { cwd: root, timeout: 20000, stdio: 'pipe' });
    expect(failed.status).toBe(1); expect(() => mergeBlobs(root, [failedBlob], join(root, 'failed-merge'), config)).toThrow();
    const empty = join(root, 'empty'); mkdirSync(empty);
    expect(() => mergeBlobs(root, [], join(empty, 'merge'), config)).toThrow();
  }, 60000);
});
