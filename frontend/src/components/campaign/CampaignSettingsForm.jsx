import { useCallback } from 'react';
import Button from '../ui/Button';
import { MAX_MESSAGES } from '../../utils/campaignTemplates';

/**
 * @param {{ templates: string[], batchSize: number }} value
 */
export function normalizeCampaignSettings(value) {
  const templates = Array.isArray(value.templates) ? [...value.templates] : [];
  const safeBatchSize = Math.max(1, Math.floor(Number(value.batchSize) || 1));
  return {
    templates,
    batchSize: safeBatchSize,
  };
}

/**
 * @param {{ templates: string[], batchSize: number }} value
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
  const batchNum = Number(value?.batchSize);
  if (!Number.isFinite(batchNum) || Math.floor(batchNum) < 1) {
    return { ok: false, error: 'Users per batch must be at least 1.' };
  }
  return { ok: true, value: normalizeCampaignSettings(value) };
}

/**
 * Controlled campaign settings: batch size, message templates.
 *
 * @param {object} props
 * @param {{ templates: string[], batchSize: number }} props.value
 * @param {(next: { templates: string[], batchSize: number }) => void} props.onChange
 * @param {string} [props.error]
 * @param {import('react').RefObject<HTMLTextAreaElement | null>} [props.firstMessageFieldRef]
 */
export default function CampaignSettingsForm({ value, onChange, error, firstMessageFieldRef }) {
  const templates = Array.isArray(value?.templates) ? value.templates : [];
  const batchSize = value?.batchSize ?? 20;

  const emit = useCallback(
    (next) => {
      onChange({
        templates: Array.isArray(next.templates) ? next.templates : [],
        batchSize: Number(next.batchSize) || 0,
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
