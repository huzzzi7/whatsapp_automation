import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import Button from '../ui/Button';
import { applyTemplatesToUser } from '../../utils/campaignTemplates';
import { normalizePhoneInput, isValidE164Digits } from '../../utils/phone';
import { sendTestStart } from '../../api';

const DEFAULT_CC = import.meta.env.VITE_DEFAULT_COUNTRY_CODE || '44';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {{ id: string; name?: string }[]} props.instances
 * @param {string} props.defaultInstanceId
 * @param {string[]} props.messageTemplateStrings
 * @param {(msg: string, type?: 'success'|'error') => void} [props.onResult] – optional parent status line
 */
export default function TestMessageModal({
  open,
  onClose,
  instances,
  defaultInstanceId,
  messageTemplateStrings,
  onResult,
}) {
  const dialogRef = useRef(null);
  const modalRef = useRef(null);
  const firstFieldRef = useRef(null);
  const [phone, setPhone] = useState('');
  const [university, setUniversity] = useState('');
  const [link, setLink] = useState('');
  const [greenInstanceId, setGreenInstanceId] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [loading, setLoading] = useState(false);

  const normalizedPhone = useMemo(
    () => normalizePhoneInput(phone, DEFAULT_CC),
    [phone],
  );

  const sequence = useMemo(() => {
    const raw = applyTemplatesToUser(
      { university, link, phone: normalizedPhone },
      messageTemplateStrings,
    );
    return raw.filter((msg) => String(msg).trim() !== '');
  }, [university, link, normalizedPhone, messageTemplateStrings]);

  useEffect(() => {
    if (open) {
      setPhone('');
      setUniversity('');
      setLink('');
      setGreenInstanceId(defaultInstanceId || '');
      setSubmitError('');
      setLoading(false);
    }
  }, [open, defaultInstanceId]);

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

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setSubmitError('');
      const gid = String(greenInstanceId || '').trim();
      if (!gid) {
        setSubmitError('Select a WhatsApp instance.');
        return;
      }
      if (!isValidE164Digits(normalizedPhone)) {
        setSubmitError('Enter a valid phone number (digits only, 10–15 digits after country code).');
        return;
      }
      if (sequence.length < 1) {
        setSubmitError('No messages to send. Adjust campaign messages so at least one line is non-empty.');
        return;
      }
      setLoading(true);
      try {
        await sendTestStart({
          greenInstanceId: gid,
          phone: normalizedPhone,
          sequence,
        });
        onResult?.(
          'You will receive the first message. Reply in WhatsApp to continue the automation.',
          'success',
        );
        onClose();
      } catch (err) {
        const msg = err?.message || 'Request failed.';
        setSubmitError(msg);
        onResult?.(msg, 'error');
      } finally {
        setLoading(false);
      }
    },
    [greenInstanceId, normalizedPhone, sequence, onClose, onResult],
  );

  const handleCancel = useCallback(() => {
    if (!loading) onClose();
  }, [loading, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="test-message-modal"
      aria-labelledby="test-message-modal-title"
      aria-describedby="test-message-modal-desc"
    >
      <form ref={modalRef} className="test-message-modal__inner" onSubmit={handleSubmit}>
        <h2 id="test-message-modal-title" className="test-message-modal__title">
          Test reply automation
        </h2>
        <p id="test-message-modal-desc" className="test-message-modal__note">
          
        </p>

        {submitError ? (
          <div className="alert-error test-message-modal__error" role="alert">
            {submitError}
          </div>
        ) : null}

        <div className="test-message-modal__field">
          <label className="ui-input-label" htmlFor="test-msg-phone">
            Phone number
          </label>
          <input
            ref={firstFieldRef}
            id="test-msg-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="ui-input-field"
            placeholder="e.g. +44 7123 456789 or 07123456789"
            value={phone}
            onChange={(ev) => setPhone(ev.target.value)}
            disabled={loading}
            aria-required="true"
            aria-invalid={phone.length > 0 && !isValidE164Digits(normalizedPhone)}
            aria-describedby="test-msg-phone-hint"
          />
          <span id="test-msg-phone-hint" className="test-message-modal__hint">
            Digits only after normalization (E.164-style, 10–15 digits).
          </span>
        </div>

        <div className="test-message-modal__field">
          <label className="ui-input-label" htmlFor="test-msg-university">
            University <span className="test-message-modal__optional">(optional)</span>
          </label>
          <input
            id="test-msg-university"
            name="university"
            type="text"
            className="ui-input-field"
            placeholder="For {{university}} in templates"
            value={university}
            onChange={(ev) => setUniversity(ev.target.value)}
            disabled={loading}
            autoComplete="organization"
          />
        </div>

        <div className="test-message-modal__field">
          <label className="ui-input-label" htmlFor="test-msg-link">
            Link <span className="test-message-modal__optional">(optional)</span>
          </label>
          <input
            id="test-msg-link"
            name="link"
            type="text"
            className="ui-input-field"
            placeholder="For {{link}} in templates"
            value={link}
            onChange={(ev) => setLink(ev.target.value)}
            disabled={loading}
            autoComplete="url"
          />
        </div>

        <div className="test-message-modal__field">
          <label className="ui-input-label" htmlFor="test-msg-instance">
            WhatsApp instance
          </label>
          <select
            id="test-msg-instance"
            name="greenInstanceId"
            className="ui-input-field instance-select"
            value={greenInstanceId}
            onChange={(ev) => setGreenInstanceId(ev.target.value)}
            disabled={loading || !instances?.length}
            aria-required="true"
          >
            {!instances?.length ? <option value="">No instances</option> : null}
            {(instances || []).map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name || inst.id}
              </option>
            ))}
          </select>
        </div>

        <div className="test-message-modal__actions">
          <Button
            type="button"
            className="ui-button--inline ui-button--secondary"
            onClick={handleCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" className="ui-button--inline" disabled={loading}>
            {loading ? 'Starting…' : 'Start test'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
