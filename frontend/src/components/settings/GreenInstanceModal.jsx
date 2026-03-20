import { useRef, useEffect, useState, useCallback } from 'react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { getGreenInstance, createGreenInstance, updateGreenInstance } from '../../api';

export default function GreenInstanceModal({ open, editingId, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const modalRef = useRef(null);
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [greenInstanceId, setGreenInstanceId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');

  const isEdit = Boolean(editingId);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
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

  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => document.getElementById('green-instance-name')?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoadError('');
    setSaveError('');
    if (editingId) {
      setLoading(true);
      getGreenInstance(editingId)
        .then((inst) => {
          setName(inst.name || '');
          setPhoneNumber(inst.phoneNumber || '');
          setGreenInstanceId(inst.greenInstanceId || '');
          setApiToken('');
        })
        .catch((e) => setLoadError(e.message || 'Failed to load'))
        .finally(() => setLoading(false));
    } else {
      setName('');
      setPhoneNumber('');
      setGreenInstanceId('');
      setApiToken('');
    }
  }, [open, editingId]);

  const handleSave = useCallback(async () => {
    setSaveError('');
    const n = name.trim();
    const gid = greenInstanceId.trim();
    const tok = apiToken.trim();
    if (!n || !gid) {
      setSaveError('Instance name and Green API instance ID are required.');
      return;
    }
    if (!isEdit && !tok) {
      setSaveError('API token is required for a new instance.');
      return;
    }
    setLoading(true);
    try {
      if (isEdit) {
        const payload = { name: n, phoneNumber: phoneNumber.trim(), greenInstanceId: gid };
        if (tok) payload.apiToken = tok;
        await updateGreenInstance(editingId, payload);
      } else {
        await createGreenInstance({
          name: n,
          phoneNumber: phoneNumber.trim(),
          greenInstanceId: gid,
          apiToken: tok,
        });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setSaveError(e.message || 'Save failed');
    } finally {
      setLoading(false);
    }
  }, [name, phoneNumber, greenInstanceId, apiToken, isEdit, editingId, onSaved, onClose]);

  return (
    <dialog ref={dialogRef} className="green-instance-modal" aria-labelledby="green-instance-modal-title">
      <div ref={modalRef} className="green-instance-modal__inner">
        <h2 id="green-instance-modal-title" className="green-instance-modal__title">
          {isEdit ? 'Edit instance' : 'Add Green API instance'}
        </h2>
        <p className="green-instance-modal__hint">
          Use values from your Green API console. Webhook URL:{' '}
          <code className="green-instance-modal__code">
            …/api/webhook/greenapi/&lt;id&gt;
          </code>{' '}
          (id is shown on this instance after save).
        </p>

        {loadError ? <div className="alert-error">{loadError}</div> : null}
        {saveError ? <div className="alert-error">{saveError}</div> : null}

        {loading && open && isEdit && !name ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : (
          <>
            <Input
              id="green-instance-name"
              label="Instance name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="off"
            />
            <Input
              label="Phone number (reference)"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              autoComplete="off"
              placeholder="e.g. number linked to WhatsApp"
            />
            <Input
              label="Green API instance ID"
              value={greenInstanceId}
              onChange={(e) => setGreenInstanceId(e.target.value)}
              required
              autoComplete="off"
            />
            <div className="ui-input-wrap">
              <label className="ui-input-label" htmlFor="green-inst-api-token">
                API token
              </label>
              <input
                id="green-inst-api-token"
                className="ui-input-field"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                autoComplete="new-password"
                placeholder={isEdit ? 'Leave blank to keep current token' : ''}
              />
            </div>
          </>
        )}

        <div className="green-instance-modal__actions">
          <Button type="button" className="ui-button--inline ui-button--secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" className="ui-button--inline" onClick={handleSave} loading={loading} disabled={loading}>
            Save
          </Button>
        </div>
      </div>
    </dialog>
  );
}
