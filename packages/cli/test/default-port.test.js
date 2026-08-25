import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { DEFAULT_SERVER_PORT } from '../../core/src/config.js';
import { collectEnvironment } from '../src/init-command.js';

test('clean install has one shared default port and it is 3008', async () => {
  assert.equal(DEFAULT_SERVER_PORT, 3008);

  const answers = ['127.0.0.1', '3306', 'yuncms', 'yuncms', 'secret', 'false'];
  const prompts = {
    async line() { return answers.shift(); },
    async secret() { return answers.shift(); },
  };
  const env = await collectEnvironment(prompts);

  assert.equal(env.PORT, '3008');
  assert.equal(env.STUDIO_ORIGIN, 'http://localhost:3008');
  assert.equal(env.AUTH_PUBLIC_URL, 'http://localhost:3008');
  assert.equal(env.FILES_LOCAL_ROOT, 'uploads');
});

test('.env.example matches the clean-install 3008 contract and contains no legacy dev ports', () => {
  const envExample = readFileSync(resolve(import.meta.dirname, '../../../.env.example'), 'utf8');
  assert.match(envExample, /^PORT=3008$/m);
  assert.match(envExample, /^STUDIO_ORIGIN=http:\/\/localhost:3008$/m);
  assert.match(envExample, /^AUTH_PUBLIC_URL=http:\/\/localhost:3008$/m);
  assert.doesNotMatch(envExample, /(?:^|[^0-9])(8055|5173)(?:[^0-9]|$)/);
});

test('operator documentation uses the single-port 3008 runtime contract', () => {
  const root = resolve(import.meta.dirname, '../../..');
  const paths = [
    resolve(root, 'README.md'),
    ...readdirSync(resolve(root, 'docs'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => resolve(root, 'docs', name)),
  ];
  const documentation = paths.map((path) => readFileSync(path, 'utf8')).join('\n');

  assert.doesNotMatch(documentation, /(?:^|[^0-9])(8055|5173)(?:[^0-9]|$)/);
  assert.match(documentation, /http:\/\/localhost:3008/);
});
