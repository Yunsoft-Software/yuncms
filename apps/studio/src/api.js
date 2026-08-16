export const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8055';

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

async function rawRequest(path, options = {}, accessToken = null) {
  const headers = new Headers(options.headers || {});
  if (options.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    body: options.body == null || typeof options.body === 'string'
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

export async function apiRequest(path, options = {}, { retryAuth = true } = {}) {
  const session = readSession();
  const { response, body } = await rawRequest(path, options, session?.access_token ?? null);

  if (response.status === 401 && retryAuth && session?.refresh_token) {
    const next = await refreshSession();
    const retried = await rawRequest(path, options, next.access_token);
    if (!retried.response.ok) throw errorFromResponse(retried.response, retried.body);
    return retried.body;
  }

  if (!response.ok) throw errorFromResponse(response, body);
  return body;
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
