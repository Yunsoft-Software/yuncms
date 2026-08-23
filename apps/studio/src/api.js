const SAME_ORIGIN_API_URL = typeof window !== 'undefined'
  ? window.location.origin
  : 'http://127.0.0.1:3008';

export const API_URL = import.meta.env.VITE_API_URL || SAME_ORIGIN_API_URL;

const SESSION_KEY = 'yuncms.studio.session';
const SESSION_EVENT = 'yuncms:session-changed';
let refreshInFlight = null;

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED', body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function emitSessionChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EVENT));
}

export function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.access_token || !session?.refresh_token) return null;
    return session;
  } catch {
    return null;
  }
}

export function writeSession(session) {
  if (!session) {
    sessionStorage.removeItem(SESSION_KEY);
    emitSessionChange();
    return null;
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  emitSessionChange();
  return session;
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  emitSessionChange();
}

export function subscribeSession(listener) {
  window.addEventListener(SESSION_EVENT, listener);
  return () => window.removeEventListener(SESSION_EVENT, listener);
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  return response.json();
}

function errorFromResponse(response, body) {
  const first = body?.errors?.[0];
  return new ApiError(first?.message || `Request failed with HTTP ${response.status}`, {
    status: response.status,
    code: first?.code || 'REQUEST_FAILED',
    body,
  });
}

function isRawBody(body) {
  if (body == null || typeof body === 'string') return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return true;
  if (typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) return true;
  return false;
}

async function rawRequest(path, options = {}, accessToken = null) {
  const headers = new Headers(options.headers || {});
  const rawBody = isRawBody(options.body);
  if (options.body != null && !rawBody && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    body: options.body == null || rawBody
      ? options.body
      : JSON.stringify(options.body),
  });
  const body = await parseResponse(response);
  return { response, body };
}

async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const current = readSession();
    if (!current?.refresh_token) throw new ApiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });

    const { response, body } = await rawRequest('/auth/refresh', {
      method: 'POST',
      body: { refresh_token: current.refresh_token },
    });

    if (!response.ok) {
      clearSession();
      throw errorFromResponse(response, body);
    }

    const next = {
      ...current,
      ...body.data,
      user: body.data?.user ?? current.user,
    };
    writeSession(next);
    return next;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function requestWithAuth(path, options = {}, retryAuth = true) {
  const session = readSession();
  const result = await rawRequest(path, options, session?.access_token ?? null);

  if (result.response.status === 401 && retryAuth && session?.refresh_token) {
    const next = await refreshSession();
    return rawRequest(path, options, next.access_token);
  }
  return result;
}

export async function apiRequest(path, options = {}, { retryAuth = true } = {}) {
  const result = await requestWithAuth(path, options, retryAuth);
  if (!result.response.ok) throw errorFromResponse(result.response, result.body);
  return result.body;
}

export async function apiBlob(path, options = {}, { retryAuth = true } = {}) {
  const result = await requestWithAuth(path, options, retryAuth);
  if (!result.response.ok) throw errorFromResponse(result.response, result.body);
  return result.response.blob();
}

export async function login(email, password) {
  const { response, body } = await rawRequest('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (!response.ok) throw errorFromResponse(response, body);
  writeSession(body.data);
  return body.data;
}

export async function authProviders() {
  const { response, body } = await rawRequest('/auth/providers');
  if (!response.ok) throw errorFromResponse(response, body);
  return Array.isArray(body?.data) ? body.data : [];
}

export function externalLoginUrl(providerId, redirect = '/') {
  const url = new URL(`${API_URL}/auth/login/${encodeURIComponent(providerId)}`);
  url.searchParams.set('redirect', redirect);
  return url.toString();
}

export async function loginWithProvider(providerId, username, password) {
  const { response, body } = await rawRequest(`/auth/login/${encodeURIComponent(providerId)}`, {
    method: 'POST',
    body: { username, password },
  });
  if (!response.ok) throw errorFromResponse(response, body);
  writeSession(body.data);
  return body.data;
}

export async function exchangeAuthCode(authCode) {
  const { response, body } = await rawRequest('/auth/exchange', {
    method: 'POST',
    body: { auth_code: authCode },
  });
  if (!response.ok) throw errorFromResponse(response, body);
  writeSession(body.data);
  return body.data;
}

export async function aiStatus() {
  const body = await apiRequest('/ai/status');
  return body?.data ?? null;
}

export async function aiChat(messages, { locale = 'tr', allowWrites = false } = {}) {
  const body = await apiRequest('/ai/chat', {
    method: 'POST',
    body: {
      messages,
      locale,
      allow_writes: allowWrites,
    },
  });
  return body?.data ?? null;
}

export async function logout() {
  const session = readSession();
  try {
    if (session?.access_token) {
      await rawRequest('/auth/logout', { method: 'POST' }, session.access_token);
    }
  } finally {
    clearSession();
  }
}

export async function health() {
  const { response, body } = await rawRequest('/health');
  if (!response.ok) throw errorFromResponse(response, body);
  return body;
}