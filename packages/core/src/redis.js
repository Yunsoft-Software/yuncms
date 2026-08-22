import { createHash } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

function redisError(code, message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

export function redactRedisUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username) url.username = '***';
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '<invalid-redis-url>';
  }
}

export function parseRedisUrl(value) {
  if (!value) throw redisError('INVALID_REDIS_CONFIG', 'REDIS_URL is required for Redis shared state');
  let url;
  try { url = new URL(value); } catch { throw redisError('INVALID_REDIS_CONFIG', 'REDIS_URL must be a valid URL'); }
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw redisError('INVALID_REDIS_CONFIG', 'REDIS_URL must use redis:// or rediss://');
  }
  const database = url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0;
  if (!Number.isInteger(database) || database < 0 || database > 15) {
    throw redisError('INVALID_REDIS_CONFIG', 'REDIS_URL database must be an integer between 0 and 15');
  }
  return Object.freeze({
    tls: url.protocol === 'rediss:',
    host: url.hostname,
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    database,
  });
}

function encodeCommand(args) {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const value = Buffer.from(String(arg));
    parts.push(`$${value.length}\r\n`, value, '\r\n');
  }
  return Buffer.concat(parts.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part)));
}

function readLine(buffer, offset) {
  const end = buffer.indexOf('\r\n', offset);
  if (end === -1) return null;
  return { value: buffer.toString('utf8', offset, end), next: end + 2 };
}

function parseReply(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const type = String.fromCharCode(buffer[offset]);
  const line = readLine(buffer, offset + 1);
  if (!line) return null;

  if (type === '+' || type === '-' || type === ':') {
    const value = type === ':' ? Number(line.value) : line.value;
    return { value, error: type === '-', next: line.next };
  }
  if (type === '$') {
    const length = Number(line.value);
    if (length === -1) return { value: null, next: line.next };
    const end = line.next + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.toString('utf8', line.next, end), next: end + 2 };
  }
  if (type === '*') {
    const count = Number(line.value);
    if (count === -1) return { value: null, next: line.next };
    let next = line.next;
    const value = [];
    for (let index = 0; index < count; index += 1) {
      const child = parseReply(buffer, next);
      if (!child) return null;
      if (child.error) return child;
      value.push(child.value);
      next = child.next;
    }
    return { value, next };
  }
  throw redisError('REDIS_PROTOCOL_ERROR', `Unsupported Redis RESP type: ${type}`);
}

export class RedisClient {
  constructor({ url, connectTimeoutMs = 5_000, commandTimeoutMs = 3_000, logger = console } = {}) {
    this.config = parseRedisUrl(url);
    this.connectTimeoutMs = connectTimeoutMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.logger = logger;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.connecting = null;
    this.closed = false;
  }

  async connect() {
    if (this.socket && !this.socket.destroyed) return this;
    if (this.connecting) return this.connecting;
    if (this.closed) throw redisError('REDIS_CLOSED', 'Redis client is closed');

    this.connecting = new Promise((resolve, reject) => {
      const options = { host: this.config.host, port: this.config.port };
      const socket = this.config.tls ? tls.connect(options) : net.createConnection(options);
      const timer = setTimeout(() => {
        socket.destroy(redisError('REDIS_CONNECT_TIMEOUT', 'Redis connection timed out'));
      }, this.connectTimeoutMs);

      const fail = (error) => {
        clearTimeout(timer);
        this.connecting = null;
        reject(redisError('REDIS_CONNECT_FAILED', 'Redis connection failed', error));
      };
      socket.once('error', fail);
      socket.once('connect', async () => {
        clearTimeout(timer);
        socket.off('error', fail);
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        socket.on('data', (chunk) => this.#onData(chunk));
        socket.on('error', (error) => this.#onSocketFailure(error));
        socket.on('close', () => this.#onSocketFailure(redisError('REDIS_DISCONNECTED', 'Redis disconnected')));
        try {
          if (this.config.password) {
            if (this.config.username) await this.command('AUTH', this.config.username, this.config.password);
            else await this.command('AUTH', this.config.password);
          }
          if (this.config.database) await this.command('SELECT', this.config.database);
          this.connecting = null;
          resolve(this);
        } catch (error) {
          socket.destroy();
          this.connecting = null;
          reject(error);
        }
      });
    });
    return this.connecting;
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.pending.length) {
      let parsed;
      try { parsed = parseReply(this.buffer); } catch (error) {
        this.#onSocketFailure(error);
        return;
      }
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.next);
      const pending = this.pending.shift();
      clearTimeout(pending.timer);
      if (parsed.error) pending.reject(redisError('REDIS_COMMAND_FAILED', `Redis command failed: ${parsed.value}`));
      else pending.resolve(parsed.value);
    }
  }

  #onSocketFailure(error) {
    const socket = this.socket;
    this.socket = null;
    if (socket && !socket.destroyed) socket.destroy();
    const pending = this.pending.splice(0);
    for (const request of pending) {
      clearTimeout(request.timer);
      request.reject(redisError('REDIS_UNAVAILABLE', 'Redis command interrupted', error));
    }
  }

  async command(...args) {
    if (!this.socket || this.socket.destroyed) await this.connect();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pending.findIndex((entry) => entry.resolve === resolve);
        if (index >= 0) this.pending.splice(index, 1);
        reject(redisError('REDIS_COMMAND_TIMEOUT', 'Redis command timed out'));
      }, this.commandTimeoutMs);
      this.pending.push({ resolve, reject, timer });
      this.socket.write(encodeCommand(args));
    });
  }

  async ping() {
    return (await this.command('PING')) === 'PONG';
  }

  async close() {
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    if (!socket || socket.destroyed) return;
    try { socket.end(encodeCommand(['QUIT'])); } catch {}
    socket.destroy();
  }
}

function assertPrefix(prefix) {
  const value = String(prefix || 'yuncms:default:');
  if (value.length < 3 || value.length > 128 || /[\r\n\0]/.test(value)) {
    throw redisError('INVALID_REDIS_CONFIG', 'Redis prefix must be between 3 and 128 safe characters');
  }
  return value.endsWith(':') ? value : `${value}:`;
}

export class RedisCacheStore {
  constructor({ client, prefix = 'yuncms:default:', namespace = 'permission', ttlMs = 30_000, logger = console } = {}) {
    if (!client?.command) throw redisError('INVALID_REDIS_CONFIG', 'RedisCacheStore requires a Redis command client');
    this.client = client;
    this.prefix = assertPrefix(prefix);
    this.namespace = String(namespace);
    this.ttlMs = ttlMs;
    this.logger = logger;
  }

  generationKey() { return `${this.prefix}${this.namespace}:generation`; }

  async #generation() {
    const value = await this.client.command('GET', this.generationKey());
    return value == null ? '0' : String(value);
  }

  async #key(key) {
    return `${this.prefix}${this.namespace}:${await this.#generation()}:${String(key)}`;
  }

  async get(key) {
    try {
      const raw = await this.client.command('GET', await this.#key(key));
      if (raw == null) return undefined;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || !Object.hasOwn(parsed, 'value')) return undefined;
      return parsed.value;
    } catch (error) {
      this.logger?.warn?.('Redis cache read failed; falling back to source of truth', { code: error?.code });
      return undefined;
    }
  }

  async set(key, value, { ttlMs = this.ttlMs } = {}) {
    try {
      const payload = JSON.stringify({ v: 1, value });
      await this.client.command('SET', await this.#key(key), payload, 'PX', ttlMs);
    } catch (error) {
      this.logger?.warn?.('Redis cache write failed; continuing without cache', { code: error?.code });
    }
    return value;
  }

  async delete(key) {
    try { return Number(await this.client.command('DEL', await this.#key(key))) > 0; } catch { return false; }
  }

  async clear() {
    try {
      await this.client.command('INCR', this.generationKey());
      return true;
    } catch (error) {
      this.logger?.warn?.('Redis cache generation invalidation failed', { code: error?.code });
      return false;
    }
  }
}

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`.trim();

export class RedisFixedWindowStore {
  constructor({ client, prefix = 'yuncms:default:', logger = console } = {}) {
    if (!client?.command) throw redisError('INVALID_REDIS_CONFIG', 'RedisFixedWindowStore requires a Redis command client');
    this.client = client;
    this.prefix = assertPrefix(prefix);
    this.logger = logger;
  }

  async consume(identity, { windowMs, max, scope = 'api' } = {}) {
    const digest = createHash('sha256').update(String(identity)).digest('hex');
    const key = `${this.prefix}rate:${scope}:${digest}`;
    const result = await this.client.command('EVAL', RATE_LIMIT_SCRIPT, 1, key, windowMs);
    const count = Number(result?.[0] ?? 0);
    const ttlMs = Math.max(1, Number(result?.[1] ?? windowMs));
    return {
      count,
      remaining: Math.max(0, max - count),
      retryAfterMs: ttlMs,
      resetAt: Date.now() + ttlMs,
    };
  }
}
