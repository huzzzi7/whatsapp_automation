/**
 * Picks a replacement Meta template when the campaign's current one becomes unusable mid-run
 * (paused, deleted — see TEMPLATE_FATAL_META_ERROR_CODES in metaCampaignSend.js) — lets
 * CampaignWorker keep sending instead of pausing/failing the whole campaign over one bad template.
 */
const metaTemplateRepository = require('../repositories/metaTemplateRepository');
const metaWhatsApp = require('../metaWhatsApp');
const { buildComponentsForTemplate } = require('../metaTemplateBuilder');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

/**
 * @param {{ metaConfig: {wabaId:string, accessToken:string, graphVersion?:string},
 *   excludeTemplateIds: Iterable<number|string>, samplePayload: object }} params
 * @returns {Promise<object|null>} a usable, currently-APPROVED-on-Meta replacement template row
 *   whose variables this campaign's contacts can actually fill in, or null if none qualify.
 */
async function findReplacementTemplate({ metaConfig, excludeTemplateIds, samplePayload }) {
  if (!metaConfig || !metaConfig.wabaId || !metaConfig.accessToken) {
    log.warn(
      { event: 'template_failover_no_meta_config' },
      'Cannot verify replacement template status without WABA config, skipping failover',
    );
    return null;
  }

  const excluded = new Set(Array.from(excludeTemplateIds || [], (id) => String(id)));
  const all = await metaTemplateRepository.listMetaTemplates();

  // Only consider templates this campaign's contacts can actually fill in — switching to one that
  // needs merge fields the uploaded sheet doesn't have would just fail every remaining send too.
  const candidates = all.filter((t) => {
    if (excluded.has(String(t.id))) return false;
    const { missing } = buildComponentsForTemplate(t, samplePayload || {});
    return missing.length === 0;
  });

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const remote = await metaWhatsApp.findTemplateByNameAndLanguage({
        wabaId: metaConfig.wabaId,
        accessToken: metaConfig.accessToken,
        name: candidate.name,
        languageCode: candidate.languageCode,
        graphVersion: metaConfig.graphVersion || undefined,
      });
      if (remote && String(remote.status || '').toUpperCase() === 'APPROVED') {
        return candidate;
      }
    } catch (err) {
      log.warn(
        { err: err.message, event: 'template_failover_status_check_failed', templateId: candidate.id },
        'Failed to check candidate replacement template status, skipping it',
      );
    }
  }

  return null;
}

module.exports = { findReplacementTemplate };
