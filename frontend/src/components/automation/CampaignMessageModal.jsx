import { useRef, useEffect, useState, useCallback } from 'react';
import Button from '../ui/Button';
import CampaignSettingsForm, { validateCampaignSettings } from '../campaign/CampaignSettingsForm';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string[]} props.messageTemplateStrings
 * @param {{ batchSize: number, delaySeconds: number, messageDelaySeconds?: number }} props.campaignSettings
 * @param {(payload: { templates: string[], batchSize: number, delaySeconds: number, messageDelaySeconds?: number }) => void} props.onSave
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
  const [formValue, setFormValue] = useState(() => ({
    templates: [...messageTemplateStrings],
    batchSize: Number(campaignSettings?.batchSize) || 20,
    delaySeconds: Number(campaignSettings?.delaySeconds) || 30,
    messageDelaySeconds: Math.max(0, Number(campaignSettings?.messageDelaySeconds) || 0),
  }));
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (open) {
      setFormValue({
        templates: [...messageTemplateStrings],
        batchSize: Number(campaignSettings?.batchSize) || 20,
        delaySeconds: Number(campaignSettings?.delaySeconds) || 30,
        messageDelaySeconds: Math.max(0, Number(campaignSettings?.messageDelaySeconds) || 0),
      });
      setSaveError('');
    }
  }, [open, messageTemplateStrings, campaignSettings]);

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

  const handleSave = useCallback(() => {
    const result = validateCampaignSettings(formValue);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSaveError('');
    onSave(result.value);
  }, [formValue, onSave]);

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

        <CampaignSettingsForm
          value={formValue}
          onChange={setFormValue}
          error={saveError}
          firstMessageFieldRef={firstFieldRef}
        />

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
