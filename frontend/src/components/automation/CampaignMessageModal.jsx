import { useRef, useEffect, useState, useCallback } from 'react';
import Button from '../ui/Button';
import { MAX_MESSAGES } from '../../utils/campaignTemplates';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string[]} props.messageTemplateStrings
 * @param {{ batchSize: number, delaySeconds: number }} props.campaignSettings
 * @param {(payload: { templates: string[], batchSize: number, delaySeconds: number }) => void} props.onSave
 */
export default function CampaignMessageModal({
  open,
  onClose,
  messageTemplateStrings,
  campaignSettings,
  onSave,
}) {
  const dialogRef = useRef(null);
  const modalRef = useRef(null);
  const firstFieldRef = useRef(null);
  const [draft, setDraft] = useState(() => [...messageTemplateStrings]);
  const [batchSize, setBatchSize] = useState(() => Number(campaignSettings?.batchSize) || 20);
  const [delayHours, setDelayHours] = useState(0);
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [delaySecondsPart, setDelaySecondsPart] = useState(30);
  const [saveError, setSaveError] = useState('');

  const setDelayPartsFromSeconds = useCallback((totalSeconds) => {
    const safe = Math.max(0, Number(totalSeconds) || 0);
    const hours = Math.floor(safe / 3600) % 24;
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    setDelayHours(hours);
    setDelayMinutes(minutes);
    setDelaySecondsPart(seconds);
  }, []);

  useEffect(() => {
    if (open) {
      setDraft([...messageTemplateStrings]);
      setBatchSize(Number(campaignSettings?.batchSize) || 20);
      setDelayPartsFromSeconds(Number(campaignSettings?.delaySeconds) || 30);
      setSaveError('');
    }
  }, [open, messageTemplateStrings, campaignSettings, setDelayPartsFromSeconds]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    }
    if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => {
      firstFieldRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleClose = () => onClose();
    const handleDialogClick = (e) => {
      if (e.target === el) onClose();
    };
    el.addEventListener('close', handleClose);
    el.addEventListener('click', handleDialogClick);
    return () => {
      el.removeEventListener('close', handleClose);
      el.removeEventListener('click', handleDialogClick);
    };
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open, onClose]);

  const updateLine = useCallback((index, value) => {
    setDraft((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const addLine = useCallback(() => {
    setDraft((prev) => (prev.length >= MAX_MESSAGES ? prev : [...prev, '']));
  }, []);

  const removeLine = useCallback((index) => {
    setDraft((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSave = useCallback(() => {
    if (draft.length < 1) {
      setSaveError('Add at least one message.');
      return;
    }
    if (!String(draft[0] ?? '').trim()) {
      setSaveError('Message 1 cannot be empty (nothing would be sent on campaign start).');
      return;
    }
    const safeBatchSize = Math.max(1, Math.floor(Number(batchSize) || 1));
    const h = Math.min(23, Math.max(0, Math.floor(Number(delayHours) || 0)));
    const m = Math.min(59, Math.max(0, Math.floor(Number(delayMinutes) || 0)));
    const s = Math.min(59, Math.max(0, Math.floor(Number(delaySecondsPart) || 0)));
    const totalDelaySeconds = (h * 3600) + (m * 60) + s;
    setSaveError('');
    onSave({
      templates: [...draft],
      batchSize: safeBatchSize,
      delaySeconds: totalDelaySeconds,
    });
  }, [draft, batchSize, delayHours, delayMinutes, delaySecondsPart, onSave]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="campaign-message-modal"
      aria-labelledby="campaign-message-modal-title"
    >
      <div ref={modalRef} className="campaign-message-modal__inner">
        <h2 id="campaign-message-modal-title" className="campaign-message-modal__title">
          Campaign Settings
        </h2>
        <p className="campaign-message-modal__note">
          You can use <code>{'{{university}}'}</code> and <code>{'{{link}}'}</code> in any message.
        </p>

        {saveError ? <div className="alert-error campaign-message-modal__error">{saveError}</div> : null}

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
              value={delayHours}
              onChange={(e) => setDelayHours(e.target.value)}
              aria-label="Delay hours"
              placeholder="Hours"
            />
            <input
              className="ui-input-field"
              type="number"
              min={0}
              max={59}
              value={delayMinutes}
              onChange={(e) => setDelayMinutes(e.target.value)}
              aria-label="Delay minutes"
              placeholder="Minutes"
            />
            <input
              className="ui-input-field"
              type="number"
              min={0}
              max={59}
              value={delaySecondsPart}
              onChange={(e) => setDelaySecondsPart(e.target.value)}
              aria-label="Delay seconds"
              placeholder="Seconds"
            />
          </div>
        </div>

        <div className="campaign-message-modal__list">
          {draft.map((text, index) => (
            <div key={index} className="campaign-message-modal__row">
              <label className="ui-input-label campaign-message-modal__label" htmlFor={`camp-msg-${index}`}>
                Message {index + 1}
              </label>
              <textarea
                ref={index === 0 ? firstFieldRef : undefined}
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
                disabled={draft.length <= 1}
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
          disabled={draft.length >= MAX_MESSAGES}
        >
          Add message
        </Button>

        <div className="campaign-message-modal__actions">
          <Button type="button" className="ui-button--inline ui-button--secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" className="ui-button--inline" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </dialog>
  );
}
