import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'waia-unit-shards/v1';
const VITEST = '2.1.9';
const MAX_REPORT = 256 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (actual, expected) => assert.deepEqual(actual, expected, 'UNIT_SHARD_EVIDENCE_MISMATCH');
function read(path) {
  const s = lstatSync(path);
  assert.ok(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.size <= MAX_REPORT, 'UNIT_SHARD_REPORT_FILE');
  return readFileSync(path);
}
const json = path => JSON.parse(read(path).toString('utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
function fileName(path, root) {
  assert.equal(typeof path, 'string');
  const full = isAbsolute(path) ? path : resolve(root, path), name = relative(root, full).split(sep).join('/');
  assert.ok(name && !name.startsWith('../') && !isAbsolute(name) && resolve(root, name) === full, 'UNIT_SHARD_FILE_PATH');
  return name;
}
export function inventory(files, root) {
  assert.ok(Array.isArray(files) && files.length > 0 && files.length <= 50000, 'UNIT_SHARD_INVENTORY');
  const names = files.map(file => fileName(file, root)).sort();
  assert.equal(new Set(names).size, names.length, 'UNIT_SHARD_DUPLICATE_FILE');
  return names;
}
export function validatePartition(full, shards) {
  assert.ok(Array.isArray(shards) && shards.length === 2);
  const names = shards.flat();
  assert.equal(new Set(names).size, names.length, 'UNIT_SHARD_DUPLICATE_PARTITION');
  equal([...names].sort(), full);
}
/** listFiles is the filesOnly CLI path: no test collection/import or fixture execution.
 * Vitest 2.1.9 ignores --shard in list; use its exported native sequencer explicitly.
 */
export async function discover(root = process.cwd(), config = join(root, 'vitest.config.ts')) {
  const { createVitest, BaseSequencer } = await import('vitest/node');
  const ctx = await createVitest('test', { root, config, watch: false });
  try {
    equal(ctx.version, VITEST);
    assert.ok(ctx.config.fileParallelism === false && ctx.config.isolate === true && !ctx.config.typecheck.enabled &&
      ctx.config.sequence.sequencer === BaseSequencer, 'UNIT_SHARD_CONFIG_CHANGED');
    const specs = await ctx.listFiles();
    // Native sharding is per pool. Current default configuration has one pool;
    // refuse future pool/workspace changes rather than silently mispartition it.
    assert.ok(specs.every(s => s[2].pool === ctx.config.pool && !s.project.name), 'UNIT_SHARD_POOL_OR_PROJECT_CHANGED');
    const full = inventory(specs.map(s => s.moduleId), root), shards = [];
    for (const index of [1, 2]) {
      ctx.config.shard = { index, count: 2 };
      const selected = await new BaseSequencer(ctx).shard(specs);
      shards.push(inventory(selected.map(s => s.moduleId), root));
    }
    validatePartition(full, shards); return { full, shards };
  } finally { await ctx.close(); }
}
export function validateReport(report, expectedFiles, root) {
  assert.ok(report && report.success === true && report.numFailedTests === 0 && report.numFailedTestSuites === 0 &&
    Array.isArray(report.testResults), 'UNIT_SHARD_REPORT_FAILED');
  equal(inventory(report.testResults.map(f => f.name), root), expectedFiles);
  let passed = 0, skipped = 0, todo = 0;
  for (const file of report.testResults) {
    assert.ok(file.status === 'passed' && file.message === '' && Array.isArray(file.assertionResults), 'UNIT_SHARD_FILE_FAILED');
    for (const result of file.assertionResults) {
      assert.ok(Array.isArray(result.failureMessages) && result.failureMessages.length === 0, 'UNIT_SHARD_ASSERTION_ERROR');
      if (result.status === 'passed') passed++;
      else if (result.status === 'skipped') skipped++;
      else if (result.status === 'todo') todo++;
      else assert.fail('UNIT_SHARD_ASSERTION_INCOMPLETE_OR_FAILED');
    }
  }
  equal(report.numTotalTests, passed + skipped + todo);
  equal(report.numPassedTests, passed); equal(report.numPendingTests, skipped); equal(report.numTodoTests, todo);
  return { files: expectedFiles.length, passed, skipped, todo };
}
export function requireSuccess(result) { equal(result, 'success'); }
function identity(root) {
  const { GITHUB_SHA, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT } = process.env;
  assert.match(GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.match(GITHUB_RUN_ID ?? '', /^[1-9][0-9]*$/); assert.match(GITHUB_RUN_ATTEMPT ?? '', /^[1-9][0-9]*$/);
  equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), GITHUB_SHA);
  equal(process.versions.node.split('.')[0], '22');
  equal(dependencyVitestVersion(root), VITEST);
  return { version: VERSION, sha: GITHUB_SHA, runId: GITHUB_RUN_ID, attempt: GITHUB_RUN_ATTEMPT,
    root, nodeMajor: 22, vitest: VITEST, configSha256: sha(read(join(root, 'vitest.config.ts'))),
    lockSha256: sha(read(join(root, 'pnpm-lock.yaml'))) };
}
export function dependencyVitestVersion(root) {
  // pnpm may hard-link dependency files to its content store. Artifact metadata
  // guards do not apply to this installed dependency's read-only version lookup.
  return JSON.parse(readFileSync(join(root, 'node_modules/vitest/package.json'), 'utf8')).version;
}
export function validateManifest(manifest, expectedIdentity, index, expectedDiscovery) {
  equal(manifest.identity, expectedIdentity); equal(manifest.index, index); equal(manifest.count, 2);
  equal(manifest.discovery, expectedDiscovery);
  assert.ok(Number.isSafeInteger(manifest.startedAt) && manifest.startedAt > 0, 'UNIT_SHARD_START');
}
/** Native merge performs no tests and refuses blob errors/version mismatches.
 * Fresh directories prevent accidental reuse; artifacts are never overwritten.
 */
export function mergeBlobs(root, blobs, destination, config = join(root, 'vitest.config.ts')) {
  mkdirSync(destination, { mode: 0o700 });
  const reports = join(destination, 'blobs'); mkdirSync(reports, { mode: 0o700 });
  for (const [i, path] of blobs.entries()) copyFileSync(path, join(reports, `${i}.json`));
  const output = join(destination, 'report.json');
  execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/vitest/vitest.mjs'),
    '--run', '--config', config, '--root', root, `--merge-reports=${reports}`, '--reporter=json', `--outputFile=${output}`],
  { cwd: root, timeout: 120000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return json(output);
}
export function verifyShardEvidence(path, expectedIdentity, index, discovery, root) {
  const manifest = json(join(path, 'manifest.json')), receipt = json(join(path, 'receipt.json'));
  equal(readdirSync(path).sort(), ['blob.json', 'manifest.json', 'merged', 'receipt.json', 'unit.log']);
  equal(readdirSync(join(path, 'merged')).sort(), ['blobs', 'report.json']);
  equal(readdirSync(join(path, 'merged/blobs')), ['0.json']);
  validateManifest(manifest, expectedIdentity, index, discovery);
  equal(receipt.identity, expectedIdentity); equal(receipt.index, index); requireSuccess(receipt.outcome);
  equal(receipt.manifestSha256, sha(read(join(path, 'manifest.json'))));
  const blob = join(path, 'blob.json'); equal(receipt.blobSha256, sha(read(blob)));
  equal(sha(read(join(path, 'merged/blobs/0.json'))), receipt.blobSha256);
  equal(receipt.reportSha256, sha(read(join(path, 'merged/report.json'))));
  equal(receipt.counts, validateReport(json(join(path, 'merged/report.json')), discovery.shards[index - 1], root));
  return blob;
}
async function main() {
  const [mode, directory, argument] = process.argv.slice(2), root = process.cwd();
  assert.ok(['prepare', 'seal', 'aggregate'].includes(mode) && directory && argument && process.argv.length === 5, 'UNIT_SHARD_ARGUMENTS');
  if (mode === 'aggregate') requireSuccess(argument); // Before artifact inspection/download work.
  const expectedIdentity = identity(root);
  if (mode === 'prepare') {
    const index = Number(argument); assert.ok(index === 1 || index === 2);
    mkdirSync(directory, { mode: 0o700 });
    write(join(directory, 'manifest.json'), { identity: expectedIdentity, index, count: 2,
      startedAt: Date.now(), discovery: await discover(root) });
    return;
  }
  if (mode === 'seal') {
    requireSuccess(argument);
    const manifest = json(join(directory, 'manifest.json'));
    validateManifest(manifest, expectedIdentity, manifest.index, await discover(root));
    assert.ok(manifest.index === 1 || manifest.index === 2);
    const blob = join(directory, 'blob.json');
    assert.ok(lstatSync(blob).mtimeMs >= manifest.startedAt, 'UNIT_SHARD_STALE_BLOB');
    const report = mergeBlobs(root, [blob], join(directory, 'merged'));
    const counts = validateReport(report, manifest.discovery.shards[manifest.index - 1], root);
    write(join(directory, 'receipt.json'), { identity: expectedIdentity, index: manifest.index, outcome: argument,
      manifestSha256: sha(read(join(directory, 'manifest.json'))), blobSha256: sha(read(blob)),
      reportSha256: sha(read(join(directory, 'merged/report.json'))), counts });
    return;
  }
  const discovery = await discover(root);
  const names = [1, 2].map(index => `unit-shard-${expectedIdentity.runId}-${expectedIdentity.attempt}-${index}`);
  equal(readdirSync(directory).sort(), [...names].sort());
  const blobs = [];
  for (const [offset, name] of names.entries()) {
    blobs.push(verifyShardEvidence(join(directory, name), expectedIdentity, offset + 1, discovery, root));
  }
  const result = mergeBlobs(root, blobs, directory + '-merged');
  console.log(JSON.stringify({ identity: expectedIdentity, ...validateReport(result, discovery.full, root),
    shards: 2, result: 'COMPLETE_UNIT_FILE_COVERAGE', intentionalSkipsRemainSkipped: true }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
