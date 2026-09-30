import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMUNITY_LINKS, printCommunityLinks } from '../src/community-links.js';

test('setup CTA is quiet in CI/pipes and visible in interactive setup or explicit help', () => {
  const messages = [];
  const output = { log(text) { messages.push(text); } };
  printCommunityLinks({ output, isTTY: false, env: {} });
  printCommunityLinks({ output, isTTY: true, env: { CI: 'true' } });
  assert.equal(messages.length, 0);
  printCommunityLinks({ output, isTTY: true, env: {} });
  printCommunityLinks({ output, isTTY: false, env: {}, help: true });
  assert.equal(messages.length, 2);
  assert.match(messages[0], /Star the project/);
  assert.match(messages[0], /Sponsor YunCMS: https:\/\/github\.com\/sponsors\/Yunsoft-Software/);
  assert.equal(COMMUNITY_LINKS.sponsorship, 'https://github.com/sponsors/Yunsoft-Software');
  for (const url of Object.values(COMMUNITY_LINKS)) assert.equal(new URL(url).protocol, 'https:');
});
