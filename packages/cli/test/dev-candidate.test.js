import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateVersion, candidatePackage, importCandidateArtifacts, packDevCandidate } from '../../../scripts/pack-dev-candidate.mjs';

test('development candidates bind versions to an immutable source revision', () => {
  assert.equal(candidateVersion('0.1.38','a'.repeat(40)),'0.1.38-dev.aaaaaaaaaaaa');
  for(const bad of ['dev','main','HEAD','a'.repeat(12)])assert.throws(()=>candidateVersion('0.1.38',bad));
});

async function artifactFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-candidate-artifacts-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = join(root, 'accepted'), output = join(root, 'imported'), revision = 'a'.repeat(40);
  await mkdir(artifacts);
  const packages = [];
  for (const name of ['@yunsoft/yuncms-core', '@yunsoft/yuncms-api', '@yunsoft/yuncms']) {
    const filename = name.replace('@', '').replace('/', '-') + '.tgz';
    // The importer treats tarballs as opaque bytes and never unpacks or rewrites them.
    const bytes = Buffer.from('accepted opaque artifact: ' + name);
    await writeFile(join(artifacts, filename), bytes);
    packages.push({ name, filename, version: candidateVersion('0.1.38', revision),
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
      sha256: createHash('sha256').update(bytes).digest('base64') });
  }
  const expected = { schema_version: 1, source_repository: 'https://github.com/Yunsoft-Software/yuncms.git', source_revision: revision, packages };
  const expectedFile = join(root, 'trusted.json');
  await writeFile(expectedFile, JSON.stringify(expected));
  await writeFile(join(artifacts, 'candidate.json'), JSON.stringify(expected));
  return { root, artifacts, output, revision, expected, expectedFile };
}

test('actual candidate CLI imports exact accepted bytes without a checkout, npm CLI or release tag', async t => {
  const fixture = await artifactFixture(t);
  const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../../../scripts/pack-dev-candidate.mjs', import.meta.url)),
    '--repo', join(fixture.root, 'absent-repository'), '--revision', fixture.revision, '--output', fixture.output,
    '--expected', fixture.expectedFile, '--artifacts', fixture.artifacts], { encoding: 'utf8' }));
  assert.deepEqual(result, fixture.expected);
  for (const { filename } of result.packages) assert.deepEqual(await readFile(join(fixture.output, filename)), await readFile(join(fixture.artifacts, filename)));
  await importCandidateArtifacts({ ...fixture, artifacts: fixture.output }); // Verify in place, without writing.
  await assert.rejects(importCandidateArtifacts(fixture), { code: 'ERR_FS_CP_EEXIST' });
});

test('candidate artifact import rejects tampered bytes, wrong manifests and unsafe filenames before copying', async t => {
  const fixture = await artifactFixture(t);
  await assert.rejects(packDevCandidate({ repo: fixture.root, ...fixture, expectedFile: null }), /EXPECTED_CANDIDATE_MANIFEST_REQUIRED/);
  await assert.rejects(importCandidateArtifacts({ ...fixture, revision: 'b'.repeat(40) }), /CANDIDATE_MANIFEST_MISMATCH/);
  const first = fixture.expected.packages[0];
  await writeFile(join(fixture.artifacts, first.filename), 'corrupted artifact');
  await assert.rejects(importCandidateArtifacts(fixture), /CANDIDATE_INTEGRITY_MISMATCH/);
  await assert.rejects(access(fixture.output), { code: 'ENOENT' });
  const unsafe = structuredClone(fixture.expected); unsafe.packages[0].filename = '../escape.tgz';
  await writeFile(join(fixture.artifacts, 'candidate.json'), JSON.stringify(unsafe));
  await assert.rejects(importCandidateArtifacts({ ...fixture, expected: unsafe }), /INVALID_PACKAGE_FILENAME/);
  await assert.rejects(importCandidateArtifacts(fixture), /CANDIDATE_MANIFEST_MISMATCH/);
  const duplicate = structuredClone(fixture.expected); duplicate.packages[1] = duplicate.packages[0];
  await assert.rejects(importCandidateArtifacts({ ...fixture, expected: duplicate }), /CANDIDATE_MANIFEST_MISMATCH/);
});
test('actual CLI and API manifests use the same candidate core', async () => {
  const names=['@yunsoft/yuncms-core','@yunsoft/yuncms-api','@yunsoft/yuncms'];
  for(const name of ['cli','api','core']) {
    const source=JSON.parse(await readFile(new URL(`../../${name}/package.json`,import.meta.url),'utf8'));
    const original=structuredClone(source),revision='b'.repeat(40);
    const result=candidatePackage(source,revision,names,'0.1.38');
    assert.equal(result.private,true);assert.equal(result.yuncmsSourceRevision,revision);
    assert.deepEqual(source,original);
    for(const [dependency,version] of Object.entries(result.dependencies||{}))assert.equal(version,names.includes(dependency)?result.version:source.dependencies[dependency]);
    assert.deepEqual(result.files,source.files);
  }
});
