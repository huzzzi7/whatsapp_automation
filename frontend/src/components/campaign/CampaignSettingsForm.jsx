import { useCallback, useMemo } from 'react';
import Button from '../ui/Button';
import { MAX_MESSAGES } from '../../utils/campaignTemplates';

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

function daySortValue(dow) {
  return dow === 0 ? 7 : dow;
}

const DAY_OPTIONS = [
  { label: 'Monday', v: 1 },
  { label: 'Tuesday', v: 2 },
  { label: 'Wednesday', v: 3 },
  { label: 'Thursday', v: 4 },
  { label: 'Friday', v: 5 },
  { label: 'Saturday', v: 6 },
  { label: 'Sunday', v: 0 },
];

/**
 * @param {{ templates: string[] }} value
 */
export function normalizeCampaignSettings(value) {
  const templates = Array.isArray(value.templates) ? [...value.templates] : [];
  const operationalAnchors = String(value.operationalAnchors || '1,5');
  return {
    templates,
    operationalAnchors,
    operationalDays: String(value.operationalDays || '1,2,3,4,5'),
    campaignEndDate: String(value.campaignEndDate || todayPlusDaysIso(7)),
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
  if (endH > 22) {
    return { ok: false, error: 'End time cannot be after 22:00 (10pm).' };
  }

  const endDate = String(value?.campaignEndDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { ok: false, error: 'Campaign end date must be a valid date.' };
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

/**
 * Controlled campaign settings: message templates and schedule.
 *
 * @param {object} props
 * @param {{ templates: string[] }} props.value
 * @param {(next: { templates: string[] }) => void} props.onChange
 * @param {string} [props.error]
 * @param {import('react').RefObject<HTMLTextAreaElement | null>} [props.firstMessageFieldRef]
 */
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
  const operationalAnchors = value?.operationalAnchors ?? '1,5';
  const operationalDays = value?.operationalDays ?? '1,2,3,4,5';
  const campaignEndDate = value?.campaignEndDate ?? todayPlusDaysIso(7);

  // Compute current day-of-week and time in campaign timezone
  const { todayDow, todayMinutes, operationalEndMinutes } = useMemo(() => {
    const tz = 'Europe/London';
    const now = new Date();

    // Get day of week in London (0=Sun, 1=Mon...6=Sat)
    const dowName = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const todayDow = dowMap[dowName] ?? 3;

    // Get current HH:MM in London
    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    const [h, m] = timeParts.split(':').map(Number);
    const todayMinutes = (h || 0) * 60 + (m || 0);

    // Parse operationalEnd (from value prop) into minutes
    const [eh, em] = String(operationalEnd || '21:00').split(':').map(Number);
    const operationalEndMinutes = (eh || 21) * 60 + (em || 0);

    return { todayDow, todayMinutes, operationalEndMinutes };
  }, [operationalEnd]);

  const emit = useCallback(
    (next) => {
      onChange({
        templates: Array.isArray(next.templates) ? next.templates : [],
        operationalAnchors: String(next.operationalAnchors || ''),
        operationalDays: String(next.operationalDays || ''),
        campaignEndDate: String(next.campaignEndDate || ''),
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
  const anchorSet = useMemo(
    () =>
      new Set(
        String(operationalAnchors || '')
          .split(',')
          .map((s) => Number(String(s).trim()))
          .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6),
      ),
    [operationalAnchors],
  );

  const isDayAvailable = useCallback(
    (dow) => {
      // Convert both to sort values for comparison (Sun=7 in sort order)
      const dowSort = dow === 0 ? 7 : dow;
      const todaySort = todayDow === 0 ? 7 : todayDow;

      if (dowSort < todaySort) return false; // past day this week — disabled
      if (dowSort === todaySort) {
        // Today: only available if current time is before operationalEnd
        return todayMinutes < operationalEndMinutes;
      }
      return true; // future day — always available
    },
    [todayDow, todayMinutes, operationalEndMinutes],
  );

  const fieldErrors = useMemo(() => {
    if (!error) return {};
    const e = String(error);
    if (e.includes('message') || e.includes('Message')) return { templates: e };
    if (e.includes('day') || e.includes('Day')) return { days: e };
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

  const { estimatedCompletion, minHoursRequired } = useMemo(() => {
    const contacts = Math.max(0, Math.floor(Number(totalContacts) || 0));
    const seqLen = Math.max(1, templates.length || 1);
    const instCount = Math.max(1, Math.floor(Number(instanceCount) || 1));
    const maxPerWindow = Math.max(1, Math.floor(Number(rateConfig.rateLimitMessagesPerWindow) || 3));
    const windowMs = Math.max(1000, Math.floor(Number(rateConfig.rateLimitWindowMs) || 60000));

    if (contacts === 0) return { estimatedCompletion: null, minHoursRequired: 0 };

    // Total first messages only (replies depend on user responses — not predictable)
    const totalMessages = contacts * seqLen;

    // Rate per minute per instance (from env config)
    const ratePerMin = maxPerWindow / (windowMs / 60000);

    // Max throughput: all instances combined, per minute
    const maxThroughputPerMin = ratePerMin * instCount;

    // Minimum minutes required at max rate
    const minMinutes = Math.ceil(totalMessages / maxThroughputPerMin);
    const minHours = Math.ceil(minMinutes / 60);

    // Selected time slot: hours per day × number of selected days
    const [startH, startM] = String(operationalStart || '09:00').split(':').map(Number);
    const [endH, endM] = String(operationalEnd || '21:00').split(':').map(Number);
    const hoursPerDay = Math.max(
      0,
      (endH * 60 + (endM || 0) - startH * 60 - (startM || 0)) / 60,
    );
    const selectedDays = daysSet.size || 1;

    let label = '';
    if (minHours < 1) {
      label = `~${minMinutes} min to complete`;
    } else if (minHours < 24) {
      label = `~${minHours}h minimum required`;
    } else {
      const days = Math.ceil(minHours / hoursPerDay || minHours / 12);
      label = `~${days} days minimum required`;
    }

    return { estimatedCompletion: label, minHoursRequired: minHours };
  }, [totalContacts, templates, instanceCount, rateConfig, operationalStart, operationalEnd, daysSet]);

  const sortedAnchors = useMemo(
    () =>
      Array.from(anchorSet)
        .map((d) => ({ d, s: daySortValue(d) }))
        .sort((a, b) => a.s - b.s),
    [anchorSet],
  );

  const startDay = sortedAnchors.length ? sortedAnchors[0].d : 1;
  const stopDay = sortedAnchors.length ? sortedAnchors[sortedAnchors.length - 1].d : 5;

  const safeStartDay = useMemo(() => {
    if (isDayAvailable(startDay)) return startDay;
    // Find first available day from DAY_OPTIONS order
    const found = DAY_OPTIONS.find((d) => isDayAvailable(d.v));
    return found ? found.v : startDay;
  }, [startDay, isDayAvailable]);

  const derivedDaysLabel = useMemo(() => {
    const count = daysSet.size || 1;
    const startLabel = DAY_OPTIONS.find((d) => d.v === safeStartDay)?.label || String(safeStartDay);
    const stopLabel = DAY_OPTIONS.find((d) => d.v === stopDay)?.label || String(stopDay);

    if (safeStartDay === stopDay || count === 1) {
      return `${startLabel} only (1 day)`;
    }
    return `${startLabel} \u2192 ${stopLabel} (${count} days)`;
  }, [daysSet.size, safeStartDay, stopDay]);

  const deriveRangeDaysSet = useCallback((a, b) => {
    const sA = daySortValue(a);
    const sB = daySortValue(b);
    const minS = Math.min(sA, sB);
    const maxS = Math.max(sA, sB);
    const finalSet = new Set();
    for (let v = minS; v <= maxS; v += 1) {
      finalSet.add(v === 7 ? 0 : v);
    }
    return finalSet;
  }, []);

  const handleStartDayChange = useCallback(
    (e) => {
      const nextStart = Number(e.target.value);
      if (!isDayAvailable(nextStart)) return; // ignore clicks on disabled
      const nextStop = daySortValue(nextStart) > daySortValue(stopDay) ? nextStart : stopDay;
      const nextAnchors = new Set([nextStart, nextStop]);
      const finalDays = deriveRangeDaysSet(nextStart, nextStop);
      emit({
        ...value,
        operationalAnchors: Array.from(nextAnchors).join(','),
        operationalDays: daysSetToString(finalDays),
      });
    },
    [emit, value, stopDay, deriveRangeDaysSet, isDayAvailable],
  );

  const handleStopDayChange = useCallback(
    (e) => {
      const nextStop = Number(e.target.value);
      if (!isDayAvailable(nextStop)) return;
      const nextStart =
        daySortValue(nextStop) < daySortValue(safeStartDay) ? nextStop : safeStartDay;
      const nextAnchors = new Set([nextStart, nextStop]);
      const finalDays = deriveRangeDaysSet(nextStart, nextStop);
      emit({
        ...value,
        operationalAnchors: Array.from(nextAnchors).join(','),
        operationalDays: daysSetToString(finalDays),
      });
    },
    [emit, value, safeStartDay, deriveRangeDaysSet, isDayAvailable],
  );

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
        <label className="ui-input-label campaign-message-modal__label">Campaign Days</label>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Start day</span>
            <select className="ui-input-field" value={safeStartDay} onChange={handleStartDayChange}>
              {DAY_OPTIONS.map((d) => {
                const available = isDayAvailable(d.v);
                return (
                  <option key={d.v} value={d.v} disabled={!available}>
                    {d.label}
                    {!available ? ' (unavailable)' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <span style={{ paddingTop: 20 }}>→</span>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Stop day</span>
            <select className="ui-input-field" value={stopDay} onChange={handleStopDayChange}>
              {DAY_OPTIONS.map((d) => {
                const available = isDayAvailable(d.v);
                return (
                  <option key={d.v} value={d.v} disabled={!available}>
                    {d.label}
                    {!available ? ' (unavailable)' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 20 }}>{derivedDaysLabel}</div>
        </div>

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
              max="22:00"
              value={operationalEnd}
              onChange={(e) => emit({ ...value, operationalEnd: e.target.value })}
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'flex-end' }}>
            Times are in Europe/London timezone
          </div>
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
