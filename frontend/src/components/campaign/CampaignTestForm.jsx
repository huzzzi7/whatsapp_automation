import { useMemo, useState, useCallback } from 'react';
import Button from '../ui/Button';
import { applyTemplatesToUser } from '../../utils/campaignTemplates';
import { normalizePhoneInput, isValidE164Digits } from '../../utils/phone';
import { sendTestStart } from '../../api';

const DEFAULT_CC = import.meta.env.VITE_DEFAULT_COUNTRY_CODE || '44';

/**
 * @param {{ phone: string; university: string; link: string; group: string; greenInstanceId: string }} value
 * @param {string[]} messageTemplateStrings
 */
export function getTestCampaignDerived(value, messageTemplateStrings) {
  const normalizedPhone = normalizePhoneInput(value?.phone ?? '', DEFAULT_CC);
  const raw = applyTemplatesToUser(
    {
      university: value?.university ?? '',
      link: value?.link ?? '',
      group: value?.group ?? '',
      phone: normalizedPhone,
    },
    messageTemplateStrings || [],
  );
  const sequence = raw.filter((msg) => String(msg).trim() !== '');
  return { normalizedPhone, sequence };
}

/**
 * @param {{ phone: string; university: string; link: string; group: string; greenInstanceId: string }} value
 * @param {string[]} messageTemplateStrings
 */
export function validateTestCampaignDetails(value, messageTemplateStrings) {
  const gid = String(value?.greenInstanceId || '').trim();
  if (!gid) return false;
  const { normalizedPhone, sequence } = getTestCampaignDerived(value, messageTemplateStrings);
  if (!isValidE164Digits(normalizedPhone)) return false;
  if (sequence.length < 1) return false;
  return true;
}

/**
 * @param {object} props
 * @param {{ phone: string, university: string, link: string, group: string, greenInstanceId: string }} props.value
 * @param {(next: object) => void} props.onChange
 * @param {{ id: string; name?: string }[]} props.instances
 * @param {string[]} props.messageTemplateStrings
 * @param {boolean} [props.loading]
 * @param {string} [props.error]
 * @param {() => Promise<void>} [props.onSubmit]
 * @param {(msg: string, type?: 'success'|'error') => void} [props.onResult]
 * @param {() => void} [props.onCancel]
 * @param {import('react').RefObject<HTMLInputElement | null>} [props.phoneInputRef]
 */
export default function CampaignTestForm({
  value,
  onChange,
  instances,
  messageTemplateStrings,
  loading: loadingProp,
  error: errorProp,
  onSubmit: onSubmitProp,
  onResult,
  onCancel,
  phoneInputRef,
}) {
  const [internalLoading, setInternalLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const loading = Boolean(loadingProp) || internalLoading;

  const { normalizedPhone } = useMemo(
    () => getTestCampaignDerived(value, messageTemplateStrings),
    [value, messageTemplateStrings],
  );

  const emit = useCallback(
    (patch) => {
      onChange({
        phone: value?.phone ?? '',
        university: value?.university ?? '',
        link: value?.link ?? '',
        group: value?.group ?? '',
        greenInstanceId: value?.greenInstanceId ?? '',
        ...patch,
      });
    },
    [onChange, value],
  );

  const runValidation = useCallback(() => {
    const gid = String(value?.greenInstanceId || '').trim();
    const { normalizedPhone: norm, sequence: seq } = getTestCampaignDerived(value, messageTemplateStrings);
    if (!gid) {
      setSubmitError('Select a WhatsApp instance.');
      return null;
    }
    if (!isValidE164Digits(norm)) {
      setSubmitError('Enter a valid phone number (digits only, 10–15 digits after country code).');
      return null;
    }
    if (seq.length < 1) {
      setSubmitError('No messages to send. Adjust campaign messages so at least one line is non-empty.');
      return null;
    }
    setSubmitError('');
    return {
      greenInstanceId: gid,
      phone: norm,
      sequence: seq,
    };
  }, [value, messageTemplateStrings]);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setSubmitError('');
      const payload = runValidation();
      if (!payload) return;

      if (onSubmitProp) {
        setInternalLoading(true);
        try {
          await onSubmitProp();
        } catch (err) {
          const msg = err?.message || 'Request failed.';
          setSubmitError(msg);
          onResult?.(msg, 'error');
        } finally {
          setInternalLoading(false);
        }
        return;
      }

      setInternalLoading(true);
      try {
        await sendTestStart(payload);
        onResult?.(
          'You will receive the first message. Reply in WhatsApp to continue the automation.',
          'success',
        );
      } catch (err) {
        const msg = err?.message || 'Request failed.';
        setSubmitError(msg);
        onResult?.(msg, 'error');
      } finally {
        setInternalLoading(false);
      }
    },
    [onSubmitProp, onResult, runValidation],
  );

  const displayError = errorProp || submitError;

  return (
    <form className="test-message-modal__inner" onSubmit={handleSubmit}>
      {displayError ? (
        <div className="alert-error test-message-modal__error" role="alert">
          {displayError}
        </div>
      ) : null}

      <div className="test-message-modal__field">
        <label className="ui-input-label" htmlFor="campaign-test-instance">
          WhatsApp instance
        </label>
        <select
          id="campaign-test-instance"
          name="greenInstanceId"
          className="ui-input-field instance-select"
          value={value?.greenInstanceId ?? ''}
          onChange={(ev) => emit({ greenInstanceId: ev.target.value })}
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

      <div className="test-message-modal__field">
        <label className="ui-input-label" htmlFor="campaign-test-phone">
          Phone number
        </label>
        <input
          ref={phoneInputRef}
          id="campaign-test-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          className="ui-input-field"
          placeholder="e.g. +44 7123 456789 or 07123456789"
          value={value?.phone ?? ''}
          onChange={(ev) => emit({ phone: ev.target.value })}
          disabled={loading}
          aria-required="true"
          aria-invalid={Boolean(value?.phone?.length && !isValidE164Digits(normalizedPhone))}
          aria-describedby="campaign-test-phone-hint"
        />
        <span id="campaign-test-phone-hint" className="test-message-modal__hint">
          Digits only after normalization (E.164-style, 10–15 digits).
        </span>
      </div>

      <div className="test-message-modal__field">
        <label className="ui-input-label" htmlFor="campaign-test-university">
          University <span className="test-message-modal__optional">(optional)</span>
        </label>
        <input
          id="campaign-test-university"
          name="university"
          type="text"
          className="ui-input-field"
          placeholder="For {{university}} in templates"
          value={value?.university ?? ''}
          onChange={(ev) => emit({ university: ev.target.value })}
          disabled={loading}
          autoComplete="organization"
        />
      </div>

      <div className="test-message-modal__field">
        <label className="ui-input-label" htmlFor="campaign-test-link">
          Link <span className="test-message-modal__optional">(optional)</span>
        </label>
        <input
          id="campaign-test-link"
          name="link"
          type="text"
          className="ui-input-field"
          placeholder="For {{link}} in templates"
          value={value?.link ?? ''}
          onChange={(ev) => emit({ link: ev.target.value })}
          disabled={loading}
          autoComplete="url"
        />
      </div>

      <div className="test-message-modal__field">
        <label className="ui-input-label" htmlFor="campaign-test-group">
          WhatsApp Group Link <span className="test-message-modal__optional">(optional)</span>
        </label>
        <input
          id="campaign-test-group"
          name="group"
          type="text"
          className="ui-input-field"
          placeholder="For {{group}} in templates"
          value={value?.group ?? ''}
          onChange={(ev) => emit({ group: ev.target.value })}
          disabled={loading}
          autoComplete="url"
        />
      </div>

      <div className="test-message-modal__actions">
        {onCancel ? (
          <Button
            type="button"
            className="ui-button--inline ui-button--secondary"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
        ) : null}
        <Button type="submit" className="ui-button--inline" disabled={loading}>
          {loading ? 'Starting…' : 'Start test'}
        </Button>
      </div>
    </form>
  );
}
