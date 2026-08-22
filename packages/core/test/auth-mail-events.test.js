import assert from 'node:assert/strict';
import test from 'node:test';

import { HookEmitter } from '../src/hooks.js';
import { SmtpMailer } from '../src/mail/smtp-mailer.js';

test('mail filters are revalidated and actions omit message bodies', async () => {
  const events = [];
  const emitter = new HookEmitter();
  emitter.registerFilter('mail.send', (message) => ({ ...message, subject: 'Changed' }));
  emitter.registerAction('mail.sent', (payload) => events.push(payload));
  const sent = [];
  const mailer = new SmtpMailer({
    from: 'noreply@example.test',
    emitter,
    transport: { async sendMail(message) { sent.push(message); return { messageId: 'm1' }; } },
  });

  await mailer.send({ to: 'user@example.test', subject: 'Original', text: 'secret body' });
  assert.equal(sent[0].subject, 'Changed');
  assert.equal(events[0].messageId, 'm1');
  assert.equal(Object.hasOwn(events[0], 'text'), false);
});

test('mail filter cannot inject header newlines', async () => {
  const emitter = new HookEmitter();
  emitter.registerFilter('mail.send', (message) => ({ ...message, subject: 'bad\r\nBcc: x@example.test' }));
  const mailer = new SmtpMailer({
    from: 'noreply@example.test',
    emitter,
    transport: { async sendMail() { throw new Error('should not send'); } },
  });
  await assert.rejects(() => mailer.send({ to: 'user@example.test', subject: 'ok', text: 'body' }), /subject is invalid/i);
});
