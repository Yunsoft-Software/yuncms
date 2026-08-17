import assert from 'node:assert/strict';
import test from 'node:test';

import { SmtpMailer } from '../src/mail/smtp-mailer.js';

test('SMTP mailer validates envelope fields and delegates message to transport', async () => {
  const sent = [];
  const transport = {
    async sendMail(message) {
      sent.push(message);
      return { messageId: 'm1' };
    },
  };
  const mailer = new SmtpMailer({ from: 'no-reply@example.com', transport });

  const result = await mailer.send({
    to: 'user@example.com',
    subject: 'Verify account',
    text: 'Open the verification link.',
  });

  assert.equal(result.messageId, 'm1');
  assert.equal(sent[0].from, 'no-reply@example.com');
  assert.equal(sent[0].to, 'user@example.com');
});

test('SMTP mailer rejects header injection attempts', async () => {
  const mailer = new SmtpMailer({
    from: 'no-reply@example.com',
    transport: { async sendMail() { throw new Error('must not send'); } },
  });

  await assert.rejects(
    mailer.send({
      to: 'user@example.com\nBcc: attacker@example.com',
      subject: 'Reset',
      text: 'body',
    }),
    (error) => error.code === 'INVALID_MAIL_MESSAGE',
  );
});
