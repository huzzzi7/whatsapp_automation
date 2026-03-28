const BASE_URL = import.meta.env.VITE_API_URL || '';

const defaultFetchOpts = { credentials: 'include' };

/** Read body as JSON; detect HTML (SPA fallback) and throw a clear error. */
async function parseJsonBody(res) {
  const text = await res.text();
  if (!text || !text.trim()) return {};
  const trimmed = text.trim();
  if (trimmed.startsWith('<')) {
    throw new Error(
      'Server returned HTML instead of JSON. From repo root run npm run server (port 3000), restart Vite (npm run dev), or set VITE_DEV_API_PROXY / VITE_API_URL. See frontend/README.md.',
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Server returned invalid JSON');
  }
}

async function apiFetch(path, options = {}) {
  const { headers: optHeaders, ...rest } = options;
  const headers = {
    Accept: 'application/json',
    ...(optHeaders || {}),
  };
  if (typeof rest.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE_URL + path, {
    ...defaultFetchOpts,
    ...rest,
    headers,
  });
  const data = await parseJsonBody(res);
  if (!res.ok || (data && data.success === false)) {
    throw new Error(data?.message || data?.error || 'API Error');
  }
  return data;
}

export async function login(credentials) {
  const res = await fetch(BASE_URL + '/api/auth/login', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
    ...defaultFetchOpts,
  });
  const data = await parseJsonBody(res);
  if (!res.ok) throw new Error(data?.error || 'Login failed');
  return data;
}

export async function logout() {
  await fetch(BASE_URL + '/api/auth/logout', {
    method: 'POST',
    ...defaultFetchOpts,
  });
}

export async function getMe() {
  const res = await fetch(BASE_URL + '/api/auth/me', {
    ...defaultFetchOpts,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return parseJsonBody(res);
}

export async function createAppUser(data) {
  const res = await fetch(BASE_URL + '/api/users', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    ...defaultFetchOpts,
  });
  const body = await parseJsonBody(res);
  if (!res.ok) throw new Error(body?.error || 'Failed to create user');
  return body;
}

export async function listAppUsers() {
  const data = await apiFetch('/api/users', { method: 'GET' });
  return data.users ?? [];
}

export async function updateAppUser(id, payload) {
  return apiFetch(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteAppUser(id) {
  const res = await fetch(BASE_URL + `/api/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    ...defaultFetchOpts,
    headers: { Accept: 'application/json' },
  });
  if (res.status === 204) return;
  const data = await parseJsonBody(res);
  if (!res.ok) throw new Error(data?.error || 'Delete failed');
}

/** Campaign recipient (phone, university, city, link, group) */
export async function createCampaignContact(payload) {
  const res = await fetch(BASE_URL + '/api/campaign/contacts', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    ...defaultFetchOpts,
  });
  const data = await parseJsonBody(res);
  if (!res.ok) throw new Error(data?.error || 'Create contact failed');
  return data;
}

/** @param {string} greenInstanceId - green_instances.id */
export async function startCampaign(
  users,
  greenInstanceId,
  batchSize,
  delaySeconds,
  messageDelaySeconds = 0,
) {
  return apiFetch('/api/campaign/start', {
    method: 'POST',
    body: JSON.stringify({
      users,
      greenInstanceId,
      batchSize,
      delaySeconds,
      messageDelaySeconds,
    }),
  });
}

export async function getCampaignStatus(jobId) {
  return apiFetch(`/api/campaign/status/${encodeURIComponent(jobId)}`, { method: 'GET' });
}

/**
 * Start reply-driven test: send message 1 only, store sequence in state (same as production campaign start).
 * Further messages are sent when the user replies (webhook → onIncomingReply).
 * @param {{ greenInstanceId: string; phone: string; sequence: string[] }} payload
 * @returns {Promise<{ ok: true; started: boolean }>}
 */
export async function sendTestStart(payload) {
  return apiFetch('/api/campaign/test-start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listGreenInstances() {
  const data = await apiFetch('/api/instances', { method: 'GET' });
  return data.instances ?? [];
}

export async function getGreenInstance(id) {
  const data = await apiFetch(`/api/instances/${encodeURIComponent(id)}`, { method: 'GET' });
  return data.instance;
}

export async function createGreenInstance(payload) {
  return apiFetch('/api/instances', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateGreenInstance(id, payload) {
  return apiFetch(`/api/instances/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteGreenInstance(id) {
  const res = await fetch(BASE_URL + `/api/instances/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    ...defaultFetchOpts,
    headers: { Accept: 'application/json' },
  });
  if (res.status === 204) return;
  const data = await parseJsonBody(res);
  if (!res.ok) throw new Error(data?.error || 'Delete failed');
}

export async function uploadFile(formData) {
  const res = await fetch(BASE_URL + '/api/upload', {
    method: 'POST',
    body: formData,
    headers: { Accept: 'application/json' },
    ...defaultFetchOpts,
  });
  const data = await parseJsonBody(res);
  if (!res.ok || data.success === false) throw new Error(data?.message || data?.error || 'Upload failed');
  return data;
}

/** Persist campaign metrics after a successful start (dashboard stats). */
export async function logCampaign(payload) {
  return apiFetch('/api/campaign/log', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Aggregated campaign metrics for the home dashboard. */
export async function getCampaignStats() {
  return apiFetch('/api/campaign/stats', { method: 'GET' });
}

/** Default campaign templates with {{university}}, {{link}}, and {{group}} placeholders. */
export async function getCampaignTemplates() {
  return apiFetch('/api/campaign/templates', { method: 'GET' });
}

export async function sendAllMessages() {
  return apiFetch('/api/send', { method: 'POST' });
}

export async function getState() {
  return apiFetch('/api/state');
}

export async function getStateByPhone(phone, greenInstanceId) {
  const q = greenInstanceId
    ? `?greenInstanceId=${encodeURIComponent(greenInstanceId)}`
    : '';
  return apiFetch(`/api/state/${encodeURIComponent(phone)}${q}`, { method: 'GET' });
}
