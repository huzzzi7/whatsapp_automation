import { useCallback } from 'react';
import Button from '../ui/Button';
import { MAX_MESSAGES } from '../../utils/campaignTemplates';

/**
 * Split total seconds into hours (0–23), minutes (0–59), seconds (0–59) — same as legacy modal.
 * @param {number} totalSeconds
 */
export function splitDelaySeconds(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  return {
    hours: Math.floor(safe / 3600) % 24,
    minutes: Math.floor((safe % 3600) / 60),
    seconds: safe % 60,
  };
}

/**
 * @param {{ hours: number, minutes: number, seconds: number }} parts
 * @returns {number}
 */
export function mergeDelayParts(parts) {
  const h = Math.min(23, Math.max(0, Math.floor(Number(parts.hours) || 0)));
  const m = Math.min(59, Math.max(0, Math.floor(Number(parts.minutes) || 0)));
  const s = Math.min(59, Math.max(0, Math.floor(Number(parts.seconds) || 0)));
  return h * 3600 + m * 60 + s;
}

/**
 * Normalize settings for save (same rules as CampaignMessageModal handleSave).
 * @param {{ templates: string[], batchSize: number, delaySeconds: number, messageDelaySeconds?: number }} value
 */
export function normalizeCampaignSettings(value) {
  const templates = Array.isArray(value.templates) ? [...value.templates] : [];
  const safeBatchSize = Math.max(1, Math.floor(Number(value.batchSize) || 1));
  const safeDelay = Math.max(0, Number(value.delaySeconds) || 0);
  const safeMessageDelay = Math.max(0, Number(value.messageDelaySeconds) || 0);
  return {
    templates,
    batchSize: safeBatchSize,
    delaySeconds: safeDelay,
    messageDelaySeconds: safeMessageDelay,
  };
}

/**
 * @param {{ templates: string[], batchSize: number, delaySeconds: number, messageDelaySeconds?: number }} value
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
  const md = Number(value?.messageDelaySeconds);
  if (!Number.isFinite(md) || md < 0) {
    return { ok: false, error: 'Delay between messages must be zero or greater.' };
  }
  return { ok: true, value: normalizeCampaignSettings(value) };
}

/**
 * Controlled campaign settings: batch size, delay (as total seconds), message templates.
 *
 * @param {object} props
 * @param {{ templates: string[], batchSize: number, delaySeconds: number, messageDelaySeconds?: number }} props.value
 * @param {(next: { templates: string[], batchSize: number, delaySeconds: number, messageDelaySeconds?: number }) => void} props.onChange
 * @param {string} [props.error]
 * @param {import('react').RefObject<HTMLTextAreaElement | null>} [props.firstMessageFieldRef]
 */
export default function CampaignSettingsForm({ value, onChange, error, firstMessageFieldRef }) {
  const templates = Array.isArray(value?.templates) ? value.templates : [];
  const batchSize = value?.batchSize ?? 20;
  const messageDelaySeconds = Math.max(0, Number(value?.messageDelaySeconds) || 0);
  const delayParts = splitDelaySeconds(value?.delaySeconds ?? 0);

  const emit = useCallback(
    (next) => {
      onChange({
        templates: Array.isArray(next.templates) ? next.templates : [],
        batchSize: Number(next.batchSize) || 0,
        delaySeconds: Number(next.delaySeconds) || 0,
        messageDelaySeconds: Math.max(0, Number(next.messageDelaySeconds) || 0),
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

  const setBatchSize = useCallback(
    (raw) => {
      emit({ ...value, batchSize: raw });
    },
    [emit, value],
  );

  const setDelayPart = useCallback(
    (field, raw) => {
      const current = splitDelaySeconds(value?.delaySeconds ?? 0);
      let h = current.hours;
      let m = current.minutes;
      let s = current.seconds;
      if (field === 'hours') h = Math.min(23, Math.max(0, Math.floor(Number(raw) || 0)));
      if (field === 'minutes') m = Math.min(59, Math.max(0, Math.floor(Number(raw) || 0)));
      if (field === 'seconds') s = Math.min(59, Math.max(0, Math.floor(Number(raw) || 0)));
      emit({ ...value, delaySeconds: mergeDelayParts({ hours: h, minutes: m, seconds: s }) });
    },
    [emit, value],
  );

  return (
    <>
      <p className="campaign-message-modal__note">
        You can use <code>{'{{university}}'}</code>, <code>{'{{link}}'}</code>, and <code>{'{{group}}'}</code> in any
        message.
      </p>

      {error ? <div className="alert-error campaign-message-modal__error">{error}</div> : null}

      <div className="campaign-message-modal__row">
        <label className="ui-input-label campaign-message-modal__label" htmlFor="camp-batch-size">
          Users per batch
        </label>
        <input
          id="camp-batch-size"
          className="ui-input-field"
          type="number"
          min={1}
          value={batchSize}
          onChange={(e) => setBatchSize(e.target.value)}
        />
      </div>

      <div className="campaign-message-modal__row">
        <label className="ui-input-label campaign-message-modal__label">Delay between batches</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(90px, 1fr))', gap: '0.5rem' }}>
          <input
            className="ui-input-field"
            type="number"
            min={0}
            max={23}
            value={delayParts.hours}
            onChange={(e) => setDelayPart('hours', e.target.value)}
            aria-label="Delay hours"
            placeholder="Hours"
          />
          <input
            className="ui-input-field"
            type="number"
            min={0}
            max={59}
            value={delayParts.minutes}
            onChange={(e) => setDelayPart('minutes', e.target.value)}
            aria-label="Delay minutes"
            placeholder="Minutes"
          />
          <input
            className="ui-input-field"
            type="number"
            min={0}
            max={59}
            value={delayParts.seconds}
            onChange={(e) => setDelayPart('seconds', e.target.value)}
            aria-label="Delay seconds"
            placeholder="Seconds"
          />
        </div>
      </div>

      <div className="campaign-message-modal__row">
        <label className="ui-input-label campaign-message-modal__label" htmlFor="camp-message-delay-sec">
          Delay between messages (seconds)
        </label>
        <input
          id="camp-message-delay-sec"
          className="ui-input-field"
          type="number"
          min={0}
          value={messageDelaySeconds}
          onChange={(e) =>
            emit({
              ...value,
              messageDelaySeconds: Number(e.target.value),
            })
          }
        />
      </div>

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

      <Button
        type="button"
        className="ui-button--secondary campaign-message-modal__add"
        onClick={addLine}
        disabled={templates.length >= MAX_MESSAGES}
      >
        Add message
      </Button>
    </>
  );
}
