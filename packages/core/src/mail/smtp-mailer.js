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

function normalizeMessage({ to, subject, text, html = undefined } = {}) {
  const recipient = assertAddress(to, 'Recipient');
  if (typeof subject !== 'string' || !subject.trim() || /[\r\n]/.test(subject)) {
    throw mailError('INVALID_MAIL_MESSAGE', 'Mail subject is invalid');
  }
  if (typeof text !== 'string' || !text) {
    throw mailError('INVALID_MAIL_MESSAGE', 'Mail text body is required');
  }
  if (html !== undefined && typeof html !== 'string') {
    throw mailError('INVALID_MAIL_MESSAGE', 'Mail HTML body must be a string');
  }
  return {
    to: recipient,
    subject: subject.trim(),
    text,
    ...(html ? { html } : {}),
  };
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
    emitter = null,
  } = {}) {
    if (!transport && (!host || typeof host !== 'string')) throw new Error('SMTP host is required');
    this.from = assertAddress(from, 'SMTP from address');
    this.emitter = emitter;
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

  setEmitter(emitter) {
    this.emitter = emitter;
    return this;
  }

  async verify() {
    if (typeof this.transport.verify !== 'function') return true;
    return this.transport.verify();
  }

  async send(message = {}, context = {}) {
    let normalized = normalizeMessage(message);
    if (this.emitter) {
      normalized = normalizeMessage(await this.emitter.filter('mail.send', normalized, {
        accountability: context.accountability ?? null,
        requestId: context.requestId ?? null,
      }));
    }

    try {
      const result = await this.transport.sendMail({
        from: this.from,
        ...normalized,
      });
      await this.emitter?.action('mail.sent', {
        to: normalized.to,
        subject: normalized.subject,
        messageId: result?.messageId ?? null,
      }, {
        accountability: context.accountability ?? null,
        requestId: context.requestId ?? null,
      });
      return result;
    } catch (error) {
      await this.emitter?.action('mail.failed', {
        to: normalized.to,
        subject: normalized.subject,
        code: error?.code ?? 'MAIL_DELIVERY_FAILED',
      }, {
        accountability: context.accountability ?? null,
        requestId: context.requestId ?? null,
      });
      throw error;
    }
  }
}
