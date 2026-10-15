import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { candidateVersion, candidatePackage } from '../../../scripts/pack-dev-candidate.mjs';

test('development candidates bind versions to an immutable source revision', () => {
  assert.equal(candidateVersion('0.1.38','a'.repeat(40)),'0.1.38-dev.aaaaaaaaaaaa');
  for(const bad of ['dev','main','HEAD','a'.repeat(12)])assert.throws(()=>candidateVersion('0.1.38',bad));
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
