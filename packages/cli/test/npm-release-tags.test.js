import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { planReleaseTagCleanup, requireCircleCiOidc } from '../../../scripts/npm-release-tags.mjs';

const names = [
  '@yunsoft/yuncms-extensions-sdk',
  '@yunsoft/yuncms-core',
  '@yunsoft/yuncms-api',
  '@yunsoft/yuncms',
];
const version = '2.1.3';
const tag = 'release-2-1-3';

function registryTags() {
  return Object.fromEntries(names.map(name => [name, { latest: version, [tag]: version, next: '2.2.0' }]));
}

test('the cleanup plans only the temporary tag and can resume after a partial removal', () => {
  const tags = registryTags();
  assert.deepEqual(planReleaseTagCleanup(version, tags), { tag, pending: names });
  delete tags[names[0]][tag];
  assert.deepEqual(planReleaseTagCleanup(version, tags), { tag, pending: names.slice(1) });
  for (const name of names) delete tags[name][tag];
  assert.deepEqual(planReleaseTagCleanup(version, tags), { tag, pending: [] });
  for (const name of names) assert.deepEqual(tags[name], { latest: version, next: '2.2.0' });
});

test('the cleanup rejects arbitrary tags, a missing package, and mixed release versions', () => {
  const tags = registryTags();
  for (const invalid of ['latest', 'v2.1.3', '2.1.3-rc.1', '02.1.3']) {
    assert.throws(() => planReleaseTagCleanup(invalid, tags), /stable release version/);
  }
  tags[names[3]].latest = '2.1.2';
  assert.throws(() => planReleaseTagCleanup(version, tags), /latest at 2\.1\.3/);
  tags[names[3]].latest = version;
  tags[names[3]][tag] = '2.1.4';
  assert.throws(() => planReleaseTagCleanup(version, tags), /release-2-1-3 at 2\.1\.3/);
  delete tags[names[3]];
  assert.throws(() => planReleaseTagCleanup(version, tags), /latest at 2\.1\.3/);
});

test('the write command requires the main-branch CircleCI job and an OIDC identity', () => {
  const env = { CIRCLECI: 'true', CIRCLE_BRANCH: 'main', NPM_ID_TOKEN: 'test-identity' };
  assert.doesNotThrow(() => requireCircleCiOidc(env));
  assert.throws(() => requireCircleCiOidc({ ...env, CIRCLECI: '' }), /requires the CircleCI/);
  assert.throws(() => requireCircleCiOidc({ ...env, CIRCLE_BRANCH: 'dev' }), /requires the CircleCI/);
  assert.throws(() => requireCircleCiOidc({ ...env, NPM_ID_TOKEN: '' }), /requires the CircleCI/);
});

test('the CircleCI job opts in explicitly and runs with the restricted npm context', async () => {
  const config = await readFile(new URL('../../../.circleci/config.yml', import.meta.url), 'utf8');
  assert.match(config, /clean-npm-release-tags:\n\s+type: boolean\n\s+default: false/);
  assert.match(config, /when: << pipeline\.parameters\.clean-npm-release-tags >>/);
  assert.match(config, /context: yuncms-npm-dist-tags\n\s+filters:\n\s+branches:\n\s+only: main/);
  assert.match(config, /circleci run oidc get --claims '\{"aud":"npm:registry\.npmjs\.org"\}'/);
  assert.match(config, /npm-release-tags\.mjs remove "\$YUNCMS_NPM_RELEASE_VERSION"/);
  assert.doesNotMatch(config, /npm (?:publish|dist-tag add)/);
});
