import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { createDockerBuildArguments, resolveImageName } from '../../../scripts/docker-image.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');

async function readRootFile(path) {
  return readFile(resolve(ROOT, path), 'utf8');
}

test('Docker runtime is a Node 24 non-root image with the complete YunCMS CLI contract', async () => {
  const dockerfile = await readRootFile('Dockerfile');

  assert.match(dockerfile, /^FROM node:24-bookworm-slim AS build$/m);
  assert.match(dockerfile, /^FROM node:24-bookworm-slim AS runtime$/m);
  assert.match(dockerfile, /npm run build:studio/);
  assert.match(dockerfile, /npm prune --omit=dev/);
  assert.match(dockerfile, /default-mysql-client tini/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^VOLUME \["\/data"\]$/m);
  assert.match(dockerfile, /^EXPOSE 3008$/m);
  assert.match(dockerfile, /\/ready/);
  assert.match(dockerfile, /ENTRYPOINT \["tini", "--", "node", "\/opt\/yuncms\/packages\/cli\/bin\/yuncms\.js"\]/);
  assert.match(dockerfile, /^CMD \["start"\]$/m);
});

test('Compose keeps MySQL and YunCMS state persistent and pins the current YunCMS release', async () => {
  const [compose, workspace, dockerEnv] = await Promise.all([
    readRootFile('compose.yaml'),
    readRootFile('package.json').then(JSON.parse),
    readRootFile('docker.env.example'),
  ]);

  assert.match(compose, /image: mysql:8\.4/);
  assert.match(compose, new RegExp(`yunsoftofficial/yuncms:${workspace.version.replaceAll('.', '\\.')}\\}`));
  assert.match(compose, /mysql-data:\/var\/lib\/mysql/);
  assert.match(compose, /yuncms-data:\/data/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\n\s+- ALL/);
  assert.match(dockerEnv, new RegExp(`YUNCMS_IMAGE=yunsoftofficial/yuncms:${workspace.version.replaceAll('.', '\\.')}`));
  assert.match(dockerEnv, /YUNCMS_DB_PASSWORD=replace-/);
  assert.match(dockerEnv, /YUNCMS_DB_ROOT_PASSWORD=replace-/);
});

test('Docker build command uses versioned and latest tags and multi-platform publishing', () => {
  assert.equal(resolveImageName({}), 'yunsoftofficial/yuncms');
  assert.equal(resolveImageName({ YUNCMS_DOCKER_IMAGE: 'example/yuncms' }), 'example/yuncms');
  assert.throws(() => resolveImageName({ YUNCMS_DOCKER_IMAGE: 'Example/YunCMS:latest' }));

  const build = createDockerBuildArguments({
    env: { YUNCMS_DOCKER_IMAGE: 'example/yuncms' },
    push: true,
    version: '1.2.3',
    revision: 'abc123',
    buildDate: '2026-09-08T00:00:00.000Z',
  });

  assert.equal(build.image, 'example/yuncms');
  assert.deepEqual(build.args.slice(-6), [
    '--platform',
    'linux/amd64,linux/arm64',
    '--provenance=true',
    '--sbom=true',
    '--push',
    ROOT,
  ]);
  assert.ok(build.args.includes('example/yuncms:1.2.3'));
  assert.ok(build.args.includes('example/yuncms:latest'));
  assert.ok(build.args.includes('VCS_REF=abc123'));
});

test('Docker build context excludes local dependencies, state and credentials', async () => {
  const dockerignore = await readRootFile('.dockerignore');
  for (const entry of ['.git', '.credentials', '.env', '.yuncms', 'node_modules', 'uploads']) {
    assert.match(dockerignore, new RegExp(`^${entry.replace('.', '\\.')}\\s*$`, 'm'));
  }
});

test('GitHub documentation presents Yunsoft branding and every installation option', async () => {
  const [readme, installation, documentationIndex] = await Promise.all([
    readRootFile('README.md'),
    readRootFile('docs/installation.md'),
    readRootFile('docs/README.md'),
  ]);

  assert.match(readme, /<a href="https:\/\/yunsoft\.com" aria-label="Yunsoft Software">/);
  assert.match(readme, /https:\/\/yunsoft\.com\/light-logo\.png/);
  assert.match(readme, /https:\/\/yunsoft\.com\/dark-logo\.png/);
  assert.match(readme, /https:\/\/hub\.docker\.com\/r\/yunsoftofficial\/yuncms/);
  assert.match(readme, /https:\/\/www\.npmjs\.com\/package\/@yunsoft\/yuncms/);
  assert.match(readme, /\| Docker Compose \|/);
  assert.match(readme, /\| `npx` \|/);
  assert.match(readme, /\| Persistent npm install \|/);
  assert.match(readme, /\| Source checkout \|/);

  for (const heading of ['## Docker Compose', '## Remote `npx`', '## Persistent npm installation', '## Source checkout']) {
    assert.match(installation, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(installation, /\[Yunsoft Software\]\(https:\/\/yunsoft\.com\)/);
  assert.match(documentationIndex, /\[Installation Options\]\(installation\.md\)/);
});
