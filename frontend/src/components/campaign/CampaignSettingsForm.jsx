import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '../ui/Button';
import { MAX_MESSAGES } from '../../utils/campaignTemplates';
import { countRemainingOperationalDays } from '../../utils/remainingOperationalDays';

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
  if (!raw) return new Set([1, 2, 3, 4, 5]);
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
 * @param {{ templates: string[] }} value
 */
export function normalizeCampaignSettings(value) {
  const templates = Array.isArray(value.templates) ? [...value.templates] : [];
  return {
    templates,
    campaignStartDate: String(value.campaignStartDate || todayIso()),
    campaignEndDate: String(value.campaignEndDate || todayPlusDaysIso(7)),
    operationalDays: String(value.operationalDays || '1,2,3,4,5'),
    operationalStart: String(value.operationalStart || '09:00'),
    operationalEnd: String(value.operationalEnd || '21:00'),
    instanceMode: value.instanceMode === 'manual' ? 'manual' : 'auto',
    selectedInstanceId: String(value.selectedInstanceId || ''),
  };
}

/**
 * @param {{ templates: string[] }} value
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function validateCampaignSettings(value) {
  const templates = value?.templates;
  if (!templates || templates.length < 1) {
    return { ok: false, error: 'Add at least one message.' };
  }
  if (!String(templates[0] ?? '').trim()) {
    return {
      ok: false,
      error: 'Message 1 cannot be empty (nothing would be sent on campaign start).',
    };
  }

  const opStart = String(value?.operationalStart || '').trim();
  const opEnd = String(value?.operationalEnd || '').trim();
  if (!/^\d{2}:\d{2}$/.test(opStart) || !/^\d{2}:\d{2}$/.test(opEnd)) {
    return { ok: false, error: 'Operational start/end times must be in HH:MM format.' };
  }
  if (opEnd <= opStart) {
    return { ok: false, error: 'Operational end time must be after start time.' };
  }

  const [startH] = opStart.split(':').map(Number);
  const [endH] = opEnd.split(':').map(Number);
  if (startH < 8) {
    return { ok: false, error: 'Start time cannot be before 08:00.' };
  }
  if (endH > 23) {
    return { ok: false, error: 'End time cannot be after 23:59.' };
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

  const mode = value?.instanceMode === 'manual' ? 'manual' : 'auto';
  if (mode === 'manual' && !String(value?.selectedInstanceId || '').trim()) {
    return { ok: false, error: 'Choose a WhatsApp instance (manual mode).' };
  }

  return { ok: true, value: normalizeCampaignSettings(value) };
}

function LondonTimeClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const timeStr = now.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const dateStr = now.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'flex-end', textAlign: 'right' }}>
      <div>
        Times are in <strong>Europe/London</strong> timezone
      </div>
      <div style={{ fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
        Current time: <strong>{timeStr}</strong> · {dateStr}
      </div>
    </div>
  );
}

export default function CampaignSettingsForm({
  value,
  onChange,
  error,
  firstMessageFieldRef,
  instances = [],
  totalContacts = 0,
  instanceCount = 1,
  rateConfig = { rateLimitMessagesPerWindow: 3, rateLimitWindowMs: 60000 },
}) {
  const templates = Array.isArray(value?.templates) ? value.templates : [];
  const instanceMode = value?.instanceMode === 'manual' ? 'manual' : 'auto';
  const selectedInstanceId = value?.selectedInstanceId ?? '';
  const operationalStart = value?.operationalStart ?? '09:00';
  const operationalEnd = value?.operationalEnd ?? '21:00';
  const operationalDays = value?.operationalDays ?? '1,2,3,4,5';
  const campaignStartDate = value?.campaignStartDate ?? todayIso();
  const campaignEndDate = value?.campaignEndDate ?? todayPlusDaysIso(7);
  const todayIsoMin = todayIso();

  const emit = useCallback(
    (next) => {
      onChange({
        templates: Array.isArray(next.templates) ? next.templates : [],
        campaignStartDate: String(next.campaignStartDate || todayIso()),
        campaignEndDate: String(next.campaignEndDate || todayPlusDaysIso(7)),
        operationalDays: String(next.operationalDays || ''),
        operationalStart: String(next.operationalStart || ''),
        operationalEnd: String(next.operationalEnd || ''),
        instanceMode: next.instanceMode === 'manual' ? 'manual' : 'auto',
        selectedInstanceId: String(next.selectedInstanceId || ''),
      });
    },
    [onChange],
  );

  const updateLine = useCallback(
    (index, text) => {
      const next = [...templates];
      next[index] = text;
      emit({ ...value, templates: next });
    },
    [emit, templates, value],
  );

  const addLine = useCallback(() => {
    if (templates.length >= MAX_MESSAGES) return;
    emit({ ...value, templates: [...templates, ''] });
  }, [emit, templates, value]);

  const removeLine = useCallback(
    (index) => {
      if (templates.length <= 1) return;
      emit({ ...value, templates: templates.filter((_, i) => i !== index) });
    },
    [emit, templates, value],
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

  const fieldErrors = useMemo(() => {
    if (!error) return {};
    const e = String(error);
    if (e.includes('message') || e.includes('Message')) return { templates: e };
    if (e.includes('day') || e.includes('Day') || e.includes('date') || e.includes('Date')) return { days: e };
    if (e.includes('time slot') || e.includes('minimum required') || e.includes('Extend your')) {
      return { time: e };
    }
    if (
      e.includes('start time') ||
      e.includes('end time') ||
      e.includes('08:00') ||
      e.includes('22:00') ||
      e.includes('after start') ||
      e.includes('HH:MM')
    )
      return { time: e };
    if (e.includes('instance') || e.includes('Instance')) return { instance: e };
    return { general: e };
  }, [error]);

  const estimatedCompletion = useMemo(() => {
    const contacts = Math.max(0, Math.floor(Number(totalContacts) || 0));
    const seqLen = Math.max(1, templates.length || 1);
    const instCount = Math.max(1, Math.floor(Number(instanceCount) || 1));
    const maxPerWindow = Math.max(1, Math.floor(Number(rateConfig.rateLimitMessagesPerWindow) || 3));
    const windowMs = Math.max(1000, Math.floor(Number(rateConfig.rateLimitWindowMs) || 60000));

    if (contacts === 0) return null;

    const totalMessages = contacts * seqLen;
    const ratePerMin = maxPerWindow / (windowMs / 60000);
    const maxThroughputPerMin = ratePerMin * instCount;
    const minMinutes = Math.ceil(totalMessages / maxThroughputPerMin);
    const minHours = Math.ceil(minMinutes / 60);

    const [startH, startM] = String(operationalStart || '09:00').split(':').map(Number);
    const [endH, endM] = String(operationalEnd || '21:00').split(':').map(Number);
    const hoursPerDay = Math.max(
      0,
      (endH * 60 + (endM || 0) - startH * 60 - (startM || 0)) / 60,
    );
    const remainingDays = countRemainingOperationalDays(
      campaignStartDate,
      campaignEndDate,
      operationalDays,
      Date.now(),
      'Europe/London',
      operationalEnd,
    );

    if (minHours < 1) {
      return `~${minMinutes} min to complete`;
    }
    if (minHours < 24) {
      return `~${minHours}h minimum required`;
    }
    const days = Math.ceil(minHours / hoursPerDay || minHours / 12);
    if (remainingDays < days) {
      return `~${days} days minimum required (${remainingDays} operational days selected)`;
    }
    return `~${remainingDays} operational days in range`;
  }, [
    totalContacts,
    templates,
    instanceCount,
    rateConfig,
    operationalStart,
    operationalEnd,
    campaignStartDate,
    campaignEndDate,
    operationalDays,
  ]);

  return (
    <>
      <p className="campaign-message-modal__note">
        You can use <code>{'{{university}}'}</code>, <code>{'{{link}}'}</code>, and <code>{'{{group}}'}</code> in any
        message.
      </p>

      {fieldErrors.general ? <div className="alert-error campaign-message-modal__error">{fieldErrors.general}</div> : null}

      <div className="campaign-message-modal__list">
        {templates.map((text, index) => (
          <div key={index} className="campaign-message-modal__row">
            <label className="ui-input-label campaign-message-modal__label" htmlFor={`camp-msg-${index}`}>
              Message {index + 1}
            </label>
            <textarea
              ref={index === 0 ? firstMessageFieldRef : undefined}
              id={`camp-msg-${index}`}
              className="ui-input-field campaign-message-modal__textarea"
              rows={3}
              value={text}
              onChange={(e) => updateLine(index, e.target.value)}
            />
            <Button
              type="button"
              className="ui-button--inline ui-button--secondary campaign-message-modal__remove"
              onClick={() => removeLine(index)}
              disabled={templates.length <= 1}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      {fieldErrors.templates ? (
        <div style={{ color: 'var(--error, #dc2626)', fontSize: 12, marginTop: 4 }}>{fieldErrors.templates}</div>
      ) : null}

      <Button
        type="button"
        className="ui-button--secondary campaign-message-modal__add"
        onClick={addLine}
        disabled={templates.length >= MAX_MESSAGES}
      >
        Add message
      </Button>

      <hr style={{ margin: '1.25rem 0', border: 0, borderTop: '1px solid var(--border)' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Schedule &amp; Operational Settings</h3>
        {estimatedCompletion ? (
          <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 500 }}>{estimatedCompletion}</span>
        ) : null}
      </div>

      <div className="campaign-message-modal__row" style={{ alignItems: 'flex-start' }}>
        <label className="ui-input-label campaign-message-modal__label">Campaign dates</label>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Start date</span>
            <input
              type="date"
              name="campaignStartDate"
              className="ui-input-field"
              min={todayIsoMin}
              value={campaignStartDate}
              onChange={handleStartDateChange}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>End date</span>
            <input
              type="date"
              name="campaignEndDate"
              className="ui-input-field"
              min={campaignStartDate || todayIsoMin}
              value={campaignEndDate}
              onChange={(e) => emit({ ...value, campaignEndDate: e.target.value })}
            />
          </div>
        </div>
        {fieldErrors.days ? (
          <div style={{ color: 'var(--error, #dc2626)', fontSize: 12, marginTop: 4 }}>{fieldErrors.days}</div>
        ) : null}
      </div>

      <div className="campaign-message-modal__row" style={{ alignItems: 'flex-start' }}>
        <label className="ui-input-label campaign-message-modal__label">Operational days</label>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1rem' }}>
            {DAY_OPTIONS.map((d) => (
              <label key={d.v} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={daysSet.has(d.v)}
                  onChange={() => toggleOperationalDay(d.v)}
                />
                <span>{d.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {fieldErrors.days ? (
          <div style={{ color: 'var(--error, #dc2626)', fontSize: 12, marginTop: 4 }}>{fieldErrors.days}</div>
        ) : null}
      </div>

      <div className="campaign-message-modal__row" style={{ alignItems: 'flex-start' }}>
        <label className="ui-input-label campaign-message-modal__label">
          Operational hours (messages only sent within this window)
        </label>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Start time</span>
            <input
              className="ui-input-field"
              type="time"
              min="08:00"
              max="21:00"
              value={operationalStart}
              onChange={(e) => emit({ ...value, operationalStart: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>End time</span>
            <input
              className="ui-input-field"
              type="time"
              min="09:00"
              max="23:59"
              value={operationalEnd}
              onChange={(e) => emit({ ...value, operationalEnd: e.target.value })}
            />
          </div>
          <LondonTimeClock />
        </div>

        {fieldErrors.time ? (
          <div style={{ color: 'var(--error, #dc2626)', fontSize: 12, marginTop: 4 }}>{fieldErrors.time}</div>
        ) : null}
      </div>

      <div className="campaign-message-modal__row" style={{ alignItems: 'flex-start' }}>
        <label className="ui-input-label campaign-message-modal__label">Instance Assignment</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="radio"
              name="instanceMode"
              value="auto"
              checked={instanceMode === 'auto'}
              onChange={() => emit({ ...value, instanceMode: 'auto' })}
            />
            <span>Auto (distribute across all instances)</span>
          </label>
          {instanceMode === 'auto' ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 24 }}>
              System will automatically distribute contacts across all configured instances
            </div>
          ) : null}

          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="radio"
              name="instanceMode"
              value="manual"
              checked={instanceMode === 'manual'}
              onChange={() => emit({ ...value, instanceMode: 'manual' })}
            />
            <span>Manual (choose specific instance)</span>
          </label>

          {instanceMode === 'manual' ? (
            <div style={{ marginLeft: 24, maxWidth: 420 }}>
              <select
                className="ui-input-field instance-select"
                value={selectedInstanceId}
                onChange={(e) => emit({ ...value, selectedInstanceId: e.target.value })}
                disabled={!instances?.length}
              >
                {!instances?.length ? <option value="">No instances</option> : <option value="">Select instance…</option>}
                {(instances || []).map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name || inst.id}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {fieldErrors.instance ? (
          <div style={{ color: 'var(--error, #dc2626)', fontSize: 12, marginTop: 4 }}>{fieldErrors.instance}</div>
        ) : null}
      </div>
    </>
  );
}
