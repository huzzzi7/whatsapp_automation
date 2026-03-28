/**
 * Default campaign message templates with {{university}}, {{link}}, and {{group}} placeholders.
 * Keep in sync with frontend/src/utils/campaignTemplates.js (DEFAULT_CAMPAIGN_TEMPLATE_STRINGS).
 */
function defaultTemplateStrings() {
  return [
    'Heyy what you studying at {{university}} in sept!',
    "Psych! There's another gc if you want to join I can add you",
    'Of course heres the link! {{group}}',
    'Did you book the welcome week tickets that came out? We all have on the gc',
    'Oh let me send you the link cause cheap rn, we did the cheapest one and queue skip',
    '{{link}}',
  ];
}

module.exports = { defaultTemplateStrings };
