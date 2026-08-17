import nodemailer from 'nodemailer';

function mailError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertAddress(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) {
    throw mailError('INVALID_MAIL_MESSAGE', `${label} is invalid`);
  }
  return value.trim();
}

export class SmtpMailer {
  constructor({
    host,
    port = 587,
    secure = false,
    user = null,
    password = null,
    from,
    transport = null,
  } = {}) {
    if (!transport && (!host || typeof host !== 'string')) throw new Error('SMTP host is required');
    this.from = assertAddress(from, 'SMTP from address');
    this.transport = transport ?? nodemailer.createTransport({
      host,
      port,
      secure: secure === true,
      ...(user || password ? {
        auth: {
          user: user ?? '',
          pass: password ?? '',
        },
      } : {}),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async verify() {
    if (typeof this.transport.verify !== 'function') return true;
    return this.transport.verify();
  }

  async send({ to, subject, text, html = undefined } = {}) {
    const recipient = assertAddress(to, 'Recipient');
    if (typeof subject !== 'string' || !subject.trim() || /[\r\n]/.test(subject)) {
      throw mailError('INVALID_MAIL_MESSAGE', 'Mail subject is invalid');
    }
    if (typeof text !== 'string' || !text) {
      throw mailError('INVALID_MAIL_MESSAGE', 'Mail text body is required');
    }

    return this.transport.sendMail({
      from: this.from,
      to: recipient,
      subject: subject.trim(),
      text,
      ...(html ? { html } : {}),
    });
  }
}
