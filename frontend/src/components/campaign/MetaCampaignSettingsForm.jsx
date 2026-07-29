import { useCallback, useEffect, useMemo, useState } from 'react';
import { listMetaTemplates } from '../../api';

function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function todayPlusDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseDaysSet(str) {
  const raw = String(str || '').trim();
  if (!raw) return new Set([0, 1, 2, 3, 4, 5, 6]);
  const set = new Set();
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const n = Number(part);
    if (Number.isFinite(n) && n >= 0 && n <= 6) set.add(n);
  }
  return set;
}

function daysSetToString(set) {
  const list = Array.from(set.values()).filter((n) => Number.isFinite(n));
  list.sort((a, b) => a - b);
  return list.join(',');
}

const DAY_OPTIONS = [
  { label: 'Mon', v: 1 },
  { label: 'Tue', v: 2 },
  { label: 'Wed', v: 3 },
  { label: 'Thu', v: 4 },
  { label: 'Fri', v: 5 },
  { label: 'Sat', v: 6 },
  { label: 'Sun', v: 0 },
];

/**
 * @param {{ metaTemplateId: string, campaignStartDate: string, campaignEndDate: string, operationalDays: string }} value
 */
export function normalizeMetaCampaignSettings(value) {
  return {
    metaTemplateId: value?.metaTemplateId != null ? String(value.metaTemplateId) : '',
    campaignStartDate: String(value?.campaignStartDate || todayIso()),
    campaignEndDate: String(value?.campaignEndDate || todayPlusDaysIso(7)),
    operationalDays: String(value?.operationalDays || '0,1,2,3,4,5,6'),
  };
}

export function validateMetaCampaignSettings(value) {
  if (!String(value?.metaTemplateId || '').trim()) {
    return { ok: false, error: 'Choose a Meta template.' };
  }
  const startDate = String(value?.campaignStartDate || '').trim();
  const endDate = String(value?.campaignEndDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return { ok: false, error: 'Campaign start date must be a valid date.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { ok: false, error: 'Campaign end date must be a valid date.' };
  }
  if (endDate < startDate) {
    return { ok: false, error: 'End date must be on or after start date.' };
  }
  const days = parseDaysSet(value?.operationalDays);
  if (days.size === 0) {
    return { ok: false, error: 'Select at least one operational day.' };
  }
  return { ok: true, value: normalizeMetaCampaignSettings(value) };
}

export default function MetaCampaignSettingsForm({ value, onChange, error }) {
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState('');

  useEffect(() => {
    let cancelled = false;
    listMetaTemplates()
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch((e) => {
        if (!cancelled) setTemplatesError(e.message || 'Failed to load templates');
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const metaTemplateId = value?.metaTemplateId ?? '';
  const campaignStartDate = value?.campaignStartDate ?? todayIso();
  const campaignEndDate = value?.campaignEndDate ?? todayPlusDaysIso(7);
  const operationalDays = value?.operationalDays ?? '0,1,2,3,4,5,6';
  const todayIsoMin = todayIso();

  const selectedTemplate = useMemo(
    () => templates.find((t) => String(t.id) === String(metaTemplateId)) || null,
    [templates, metaTemplateId],
  );

  const emit = useCallback(
    (next) => {
      onChange({
        metaTemplateId: String(next.metaTemplateId || ''),
        campaignStartDate: String(next.campaignStartDate || todayIso()),
        campaignEndDate: String(next.campaignEndDate || todayPlusDaysIso(7)),
        operationalDays: String(next.operationalDays || ''),
      });
    },
    [onChange],
  );

  const daysSet = useMemo(() => parseDaysSet(operationalDays), [operationalDays]);

  const toggleOperationalDay = useCallback(
    (dayValue) => {
      const next = new Set(daysSet);
      if (next.has(dayValue)) {
        if (next.size <= 1) return;
        next.delete(dayValue);
      } else {
        next.add(dayValue);
      }
      emit({ ...value, operationalDays: daysSetToString(next) });
    },
    [daysSet, emit, value],
  );

  const handleStartDateChange = useCallback(
    (e) => {
      const nextStart = e.target.value;
      let nextEnd = campaignEndDate;
      if (nextEnd && nextStart > nextEnd) nextEnd = nextStart;
      emit({ ...value, campaignStartDate: nextStart, campaignEndDate: nextEnd });
    },
    [emit, value, campaignEndDate],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 560 }}>
      <p className="campaign-message-modal__note">
        Sends use a pre-approved Meta template. Variables are filled from matching column names in your uploaded
        sheet.
      </p>

      {error ? <div className="alert-error">{error}</div> : null}

      <div>
        <label className="ui-input-label" htmlFor="meta-campaign-template">
          Template
        </label>
        {templatesLoading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading templates…</p>
        ) : templatesError ? (
          <div className="alert-error">{templatesError}</div>
        ) : templates.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            No templates registered yet — add one on the Settings page.
          </p>
        ) : (
          <select
            id="meta-campaign-template"
            className="ui-input-field"
            value={metaTemplateId}
            onChange={(e) => emit({ ...value, metaTemplateId: e.target.value })}
          >
            <option value="">Select template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.languageCode})
              </option>
            ))}
          </select>
        )}
        {selectedTemplate ? (
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {selectedTemplate.variables.length > 0
              ? `Requires sheet columns: ${selectedTemplate.variables.join(', ')}`
              : 'No variables required.'}
          </p>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px' }}>
          <label className="ui-input-label" htmlFor="meta-campaign-start-date">
            Start date
          </label>
          <input
            id="meta-campaign-start-date"
            type="date"
            className="ui-input-field"
            min={todayIsoMin}
            value={campaignStartDate}
            onChange={handleStartDateChange}
          />
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <label className="ui-input-label" htmlFor="meta-campaign-end-date">
            End date
          </label>
          <input
            id="meta-campaign-end-date"
            type="date"
            className="ui-input-field"
            min={campaignStartDate || todayIsoMin}
            value={campaignEndDate}
            onChange={(e) => emit({ ...value, campaignEndDate: e.target.value })}
          />
        </div>
      </div>

      <div>
        <span className="ui-input-label">Operational days</span>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
          {DAY_OPTIONS.map((d) => (
            <button
              key={d.v}
              type="button"
              onClick={() => toggleOperationalDay(d.v)}
              className={`ui-button--inline ${daysSet.has(d.v) ? '' : 'ui-button--secondary'}`}
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        Sends are spread evenly across the full day (00:00–23:59), capped at 1800 messages/day per Meta's rate limit.
      </p>
    </div>
  );
}
