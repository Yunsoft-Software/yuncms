import assert from 'node:assert/strict';
import test from 'node:test';
import { SmtpMailer } from '@yunsoft/yuncms-core';
import { startFlowNetwork } from '../../../test/helpers/flow-network.mjs';

test('real pipelined SMTP accepts one valid message and never records a rejected envelope', async () => {
  const network = await startFlowNetwork();
  try {
    const mailer = new SmtpMailer({ host: '127.0.0.1', port: network.smtpPort, from: 'sender@example.test' });
    await mailer.send({ to: 'reader@example.test', subject: 'Accepted', text: 'Owned local mailbox' });
    assert.equal(network.messages.length, 1);
    assert.match(network.messages[0].raw, /Owned local mailbox/);
    await assert.rejects(mailer.send({ to: 'blocked@example.test', subject: 'Denied', text: 'Must not be delivered' }), { code: 'EENVELOPE' });
    assert.equal(network.messages.length, 1);
    assert.ok(network.messages[0].to.some(address => address.includes('reader@example.test')));
  } finally {
    await network.close();
  }
});
