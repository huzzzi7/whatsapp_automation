/**
 * Campaign message templates with {{university}} and {{link}}.
 * Keep in sync with server src/campaignDefaults.js (used before API load).
 */
export const DEFAULT_CAMPAIGN_TEMPLATE_STRINGS = [
  'Heyy what you studying at {{university}} in sept!',
  "Psych! There's another gc if you want to join I can add you",
  'Of course heres the link!',
  'Did you book the welcome week tickets that came out? We all have on the gc',
  'Oh let me send you the link cause cheap rn, we did the cheapest one and queue skip',
  '{{link}}',
];

const MAX_MESSAGES = 25;

/**
 * @param {Record<string, unknown>} user
 * @param {string[]} templateStrings
 * @returns {string[]}
 */
export function applyTemplatesToUser(user, templateStrings) {
  const uni = user?.university != null ? String(user.university) : '';
  const link = user?.link != null ? String(user.link) : '';
  return (templateStrings || []).map((t) =>
    String(t).replace(/\{\{university\}\}/gi, uni).replace(/\{\{link\}\}/gi, link),
  );
}

/**
 * Clone upload result and recompute every user's sequence from templates.
 * @param {{ users?: unknown[]; byUniversity?: Record<string, unknown[]>; universities?: string[]; totalUsers?: number } | null | undefined} uploadResult
 * @param {string[]} templateStrings
 */
export function applyTemplatesToUploadResult(uploadResult, templateStrings) {
  if (!uploadResult) return null;
  const users = (uploadResult.users || []).map((u) => ({
    ...u,
    sequence: applyTemplatesToUser(u, templateStrings),
  }));
  const byUniversity = {};
  users.forEach((u) => {
    const key = u.university || '(blank)';
    if (!byUniversity[key]) byUniversity[key] = [];
    byUniversity[key].push(u);
  });
  const universities = Object.keys(byUniversity).sort();
  return {
    ...uploadResult,
    users,
    byUniversity,
    universities,
    totalUsers: users.length,
  };
}

export { MAX_MESSAGES };
