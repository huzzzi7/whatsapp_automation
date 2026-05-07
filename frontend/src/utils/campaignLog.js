/**
 * Build payload for POST /api/campaign/log (same shape as CampaignWizardPage).
 * @param {object} uploadResult - snapshot with byUniversity, universities
 * @param {unknown[]} usersSent
 * @param {{ scope: 'all' } | { scope: 'university', universityName: string }} meta
 */
export function buildCampaignLogPayload(uploadResult, usersSent, meta) {
  const byU = uploadResult?.byUniversity ?? {};
  const unis = uploadResult?.universities ?? [];
  const campaignId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `camp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  if (meta?.scope === 'all') {
    return {
      campaignId,
      totalUsers: usersSent.length,
      totalUniversities: unis.length,
      universityStats: unis.map((name) => ({
        name,
        usersSent: (byU[name] ?? []).length,
      })),
    };
  }

  const uniName = meta?.universityName ?? '(unknown)';
  return {
    campaignId,
    totalUsers: usersSent.length,
    totalUniversities: 1,
    universityStats: [{ name: uniName, usersSent: usersSent.length }],
  };
}
