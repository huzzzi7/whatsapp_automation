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

export async function getConfig() {
  try {
    const data = await apiFetch('/api/config', { method: 'GET' });
    return {
      rateLimitMessagesPerWindow: Number(data.rateLimitMessagesPerWindow) || 3,
      rateLimitWindowMs: Number(data.rateLimitWindowMs) || 60000,
    };
  } catch {
    return { rateLimitMessagesPerWindow: 3, rateLimitWindowMs: 60000 };
  }
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

export async function startCampaign(users, options = {}) {
  const body = {
    users,
    provider: 'meta',
    metaTemplateId: options?.metaTemplateId,
    name: options?.name,
    campaignStartDate: options?.campaignStartDate,
    campaignEndDate: options?.campaignEndDate,
    ...(options?.scheduledAt != null && String(options.scheduledAt).trim() !== '' ? { scheduledAt: options.scheduledAt } : {}),
  };
  return apiFetch('/api/campaign/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getCampaignStatus(jobId) {
  return apiFetch(`/api/campaign/status/${encodeURIComponent(jobId)}`, { method: 'GET' });
}

/** @returns {Promise<{ running: object | null, paused: object[], queued: object[] }>} */
export async function getActiveCampaigns() {
  return apiFetch('/api/campaigns/active', { method: 'GET' });
}

/** @returns {Promise<{ campaigns: object[] }>} */
export async function listCampaignsApi() {
  return apiFetch('/api/campaigns', { method: 'GET' });
}

/** @returns {Promise<{ campaign: object, contacts?: object[] }>} */
export async function getCampaignDetail(id) {
  return apiFetch(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'GET' });
}

/** @returns {Promise<{ contacts: object[], total: number, overallTotal: number, repliedCount: number, page: number, limit: number, totalPages: number, statusCounts: { sent: number, delivered: number, read: number, failed: number } }>} */
export async function listCampaignContacts(campaignId, { page = 1, limit = 50, deliveryStatus = '', hasReplied = false } = {}) {
  const q = new URLSearchParams();
  q.set('page', String(page));
  q.set('limit', String(limit));
  if (deliveryStatus) q.set('deliveryStatus', deliveryStatus);
  if (hasReplied) q.set('hasReplied', 'true');
  return apiFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/contacts?${q}`, { method: 'GET' });
}

export async function pauseCampaign(id) {
  return apiFetch(`/api/campaigns/${encodeURIComponent(id)}/pause`, { method: 'POST', body: '{}' });
}

export async function resumeCampaign(id) {
  return apiFetch(`/api/campaigns/${encodeURIComponent(id)}/resume`, { method: 'POST', body: '{}' });
}

export async function updateCampaignSchedule(id, scheduleData) {
  return apiFetch(`/api/campaigns/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(scheduleData),
  });
}

export async function startQueuedCampaign(id) {
  return apiFetch(`/api/campaigns/${encodeURIComponent(id)}/start`, { method: 'POST', body: '{}' });
}

export async function stopCampaign(id) {
  return apiFetch(`/api/campaigns/${encodeURIComponent(id)}/stop`, { method: 'POST', body: '{}' });
}

export async function deleteCampaign(id) {
  return apiFetch(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getMetaConfig() {
  return apiFetch('/api/meta-config', { method: 'GET' });
}

export async function updateMetaConfig(payload) {
  return apiFetch('/api/meta-config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function testMetaConnection() {
  return apiFetch('/api/meta/test-connection', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function sendMetaTestTemplate(payload) {
  return apiFetch('/api/meta/test-send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listMetaTemplates() {
  const data = await apiFetch('/api/meta-templates', { method: 'GET' });
  return data?.templates ?? [];
}

export async function createMetaTemplate(payload) {
  const data = await apiFetch('/api/meta-templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data?.template;
}

export async function updateMetaTemplate(id, payload) {
  const data = await apiFetch(`/api/meta-templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return data?.template;
}

export async function deleteMetaTemplate(id) {
  return apiFetch(`/api/meta-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function verifyTemplateOptOutButton(id) {
  const data = await apiFetch(`/api/meta-templates/${encodeURIComponent(id)}/verify-opt-out-button`, {
    method: 'POST',
    body: '{}',
  });
  return data?.template;
}

export async function listOptedOutContacts() {
  const data = await apiFetch('/api/opted-out', { method: 'GET' });
  return data?.contacts ?? [];
}

export async function removeOptOut(phone) {
  return apiFetch(`/api/opted-out/${encodeURIComponent(phone)}`, { method: 'DELETE' });
}

export async function listUniversityLinks() {
  const data = await apiFetch('/api/university-links', { method: 'GET' });
  return data?.links ?? [];
}

export async function createUniversityLink(payload) {
  const data = await apiFetch('/api/university-links', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data?.link;
}

export async function updateUniversityLink(id, payload) {
  const data = await apiFetch(`/api/university-links/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return data?.link;
}

export async function deleteUniversityLink(id) {
  return apiFetch(`/api/university-links/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** @returns {Promise<{ total: number, conversations: object[], page: number, limit: number }>} */
export async function listConversations({ campaignId = '', deliveryStatus = '', unseen = false, qualified = false, page = 1, limit = 50 } = {}) {
  const q = new URLSearchParams();
  if (campaignId) q.set('campaignId', campaignId);
  if (deliveryStatus) q.set('deliveryStatus', deliveryStatus);
  if (unseen) q.set('unseen', 'true');
  if (qualified) q.set('qualified', 'true');
  q.set('page', String(page));
  q.set('limit', String(limit));
  return apiFetch(`/api/conversations?${q}`, { method: 'GET' });
}

/** @returns {Promise<{ messages: object[] }>} */
export async function getConversationMessages(phone, { page = 1, limit = 100 } = {}) {
  const q = new URLSearchParams();
  q.set('page', String(page));
  q.set('limit', String(limit));
  return apiFetch(`/api/conversations/${encodeURIComponent(phone)}/messages?${q}`, { method: 'GET' });
}

export async function markConversationSeen(phone) {
  return apiFetch(`/api/conversations/${encodeURIComponent(phone)}/seen`, { method: 'POST', body: '{}' });
}

/**
 * @param {string} phone
 * @param {{ text?: string, file?: File }} payload
 */
export async function sendConversationMessage(phone, { text = '', file = null } = {}) {
  if (file) {
    const form = new FormData();
    if (text) form.append('text', text);
    form.append('file', file);
    const res = await fetch(`${BASE_URL}/api/conversations/${encodeURIComponent(phone)}/messages`, {
      method: 'POST',
      body: form,
      ...defaultFetchOpts,
    });
    const data = await parseJsonBody(res);
    if (!res.ok || data.success === false) throw new Error(data?.error || 'Failed to send message');
    return data;
  }
  return apiFetch(`/api/conversations/${encodeURIComponent(phone)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/** @returns {string} URL for an <img>/<a> tag; safe to use directly, same-origin cookies apply. */
export function getMediaUrl(mediaPath, mimeType) {
  const q = mimeType ? `?mime=${encodeURIComponent(mimeType)}` : '';
  return `${BASE_URL}/api/media/${encodeURIComponent(mediaPath)}${q}`;
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

