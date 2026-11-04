import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const root = new URL('../../../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');
test('mixed distribution retains MIT and identifies only explicitly marked new Premium code', async () => {
  const license = await read('LICENSE');
  const mit = await read('LICENSES/MIT.txt');
  const commercial = await read('LICENSES/LicenseRef-YunCMS-Commercial.txt');
  assert.ok(license.includes(mit.trim())); assert.ok(license.includes(commercial.trim()));
  assert.match(license, /Previously released MIT versions, including 0\.1\.47, retain their MIT grants/);
  assert.match(commercial, /one-time purchase grants perpetual use/);
  for (const name of ['core', 'api']) {
    assert.equal(await read(`packages/${name}/LICENSE`), license);
    assert.match(await read(`packages/${name}/README.md`), /MIT Community code and explicitly marked commercial Premium/);
    assert.equal(JSON.parse(await read(`packages/${name}/package.json`)).license, 'SEE LICENSE IN LICENSE');
  }
  for (const name of ['cli', 'extensions-sdk']) {
    assert.equal(JSON.parse(await read(`packages/${name}/package.json`)).license, 'MIT');
    assert.match(await read(`packages/${name}/LICENSE`), /MIT License/);
  }
  for (const directory of ['packages/core/src/premium/', 'apps/studio/src/premium/']) {
    for (const name of await readdir(new URL(directory, root))) {
      assert.match(await read(`${directory}${name}`), /^\/\/ SPDX-FileCopyrightText:[^\n]+\n\/\/ SPDX-License-Identifier: LicenseRef-YunCMS-Commercial\n/);
    }
  }
  assert.match(await read('README.md'), /Community code and the extensions SDK retain MIT/);
  assert.match(await read('docs/README.md'), /features-and-license\.md/);
  const dockerfile = await read('Dockerfile');
  assert.match(dockerfile, /org\.opencontainers\.image\.licenses="MIT AND LicenseRef-YunCMS-Commercial"/);
  assert.match(dockerfile, /^COPY --chown=node:node LICENSES \/opt\/yuncms\/LICENSES$/m);
});

test('source and Docker examples expose the same optional license settings with empty defaults', async () => {
  const compose = await read('compose.yaml');
  for (const key of ['YUNCMS_LICENSE_TOKEN', 'YUNCMS_LICENSE_PUBLIC_KEY', 'YUNCMS_LICENSE_DOMAIN', 'YUNCMS_LICENSE_INSTANCE_ID', 'YUNCMS_FEATURES_DISABLED']) {
    for (const file of ['.env.example', 'docker.env.example']) assert.ok((await read(file)).includes(`\n${key}=\n`));
    assert.ok(compose.includes(`${key}: \${${key}:-}`));
  }
});
