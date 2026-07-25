import { useState, useEffect, useCallback } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import AuthStatusBadge from '../components/ui/AuthStatusBadge';
import GreenInstanceModal from '../components/settings/GreenInstanceModal';
import {
  listGreenInstances,
  deleteGreenInstance,
  refreshInstanceStatus,
  updateInstanceActiveState,
  getMetaConfig,
  updateMetaConfig,
  testMetaConnection,
  sendMetaTestTemplate,
} from '../api';

function IconEdit() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function webhookFullUrl(webhookPath) {
  const base = (import.meta.env.VITE_PUBLIC_WEBHOOK_BASE_URL || import.meta.env.VITE_API_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (!webhookPath) return '';
  return base ? `${base}${webhookPath}` : '';
}

// Green API instances are hidden from Settings while Meta WhatsApp is the primary provider.
// Flip this back to true to re-show the Green instances section — all CRUD logic below is untouched.
const SHOW_GREEN_INSTANCES = false;

const EMPTY_META_FORM = {
  displayName: '',
  phoneNumberId: '',
  accessToken: '',
  wabaId: '',
  graphVersion: '',
  isEnabled: true,
};

export default function SettingsPage() {
  const [instances, setInstances] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const [metaForm, setMetaForm] = useState(EMPTY_META_FORM);
  const [metaTokenMasked, setMetaTokenMasked] = useState('');
  const [metaHasToken, setMetaHasToken] = useState(false);
  const [metaDefaultGraphVersion, setMetaDefaultGraphVersion] = useState('v25.0');
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaTesting, setMetaTesting] = useState(false);
  const [metaSending, setMetaSending] = useState(false);
  const [metaMessage, setMetaMessage] = useState('');
  const [metaError, setMetaError] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testTemplateName, setTestTemplateName] = useState('');
  const [testLanguageCode, setTestLanguageCode] = useState('en_GB');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listGreenInstances();
      setInstances(list);
    } catch (e) {
      setError(e.message || 'Failed to load instances');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    setMetaError('');
    try {
      const data = await getMetaConfig();
      const c = data?.config || {};
      setMetaForm({
        displayName: c.displayName || '',
        phoneNumberId: c.phoneNumberId || '',
        accessToken: '',
        wabaId: c.wabaId || '',
        graphVersion: c.graphVersion || '',
        isEnabled: c.isEnabled !== false,
      });
      setMetaTokenMasked(c.accessTokenMasked || '');
      setMetaHasToken(Boolean(c.hasAccessToken));
      if (data?.defaults?.graphVersion) {
        setMetaDefaultGraphVersion(String(data.defaults.graphVersion));
      }
    } catch (e) {
      setMetaError(e.message || 'Failed to load Meta config');
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadMeta();
  }, [load, loadMeta]);

  const openCreate = () => {
    setEditingId(null);
    setModalOpen(true);
  };

  const openEdit = (id) => {
    setEditingId(id);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete instance "${name}"? Webhooks using this id will stop working.`)) return;
    try {
      await deleteGreenInstance(id);
      await load();
    } catch (e) {
      setError(e.message || 'Delete failed');
    }
  };

  const handleToggleActive = async (inst) => {
    try {
      await updateInstanceActiveState(inst.id, !inst.manualDisabled);
      await load();
    } catch (e) {
      setError(e.message || 'Toggle failed');
    }
  };

  const handleRefreshStatus = async (id) => {
    try {
      await refreshInstanceStatus(id);
      await load();
    } catch (e) {
      setError(e.message || 'Refresh failed');
    }
  };

  const handleMetaField = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setMetaForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleMetaSave = async () => {
    setMetaSaving(true);
    setMetaError('');
    setMetaMessage('');
    try {
      const payload = {
        displayName: metaForm.displayName,
        phoneNumberId: metaForm.phoneNumberId,
        wabaId: metaForm.wabaId,
        graphVersion: metaForm.graphVersion,
        isEnabled: metaForm.isEnabled,
      };
      if (String(metaForm.accessToken || '').trim()) {
        payload.accessToken = String(metaForm.accessToken).trim();
      }
      const data = await updateMetaConfig(payload);
      const c = data?.config || {};
      setMetaForm((prev) => ({
        ...prev,
        displayName: c.displayName || '',
        phoneNumberId: c.phoneNumberId || '',
        accessToken: '',
        wabaId: c.wabaId || '',
        graphVersion: c.graphVersion || '',
        isEnabled: c.isEnabled !== false,
      }));
      setMetaTokenMasked(c.accessTokenMasked || '');
      setMetaHasToken(Boolean(c.hasAccessToken));
      setMetaMessage('Meta config saved.');
    } catch (e) {
      setMetaError(e.message || 'Save failed');
    } finally {
      setMetaSaving(false);
    }
  };

  const handleMetaTestConnection = async () => {
    setMetaTesting(true);
    setMetaError('');
    setMetaMessage('');
    try {
      const data = await testMetaConnection();
      const pn = data?.phoneNumber || {};
      const label = pn.verified_name || pn.display_phone_number || pn.id || 'OK';
      setMetaMessage(`Connection OK: ${label}`);
    } catch (e) {
      setMetaError(e.message || 'Test connection failed');
    } finally {
      setMetaTesting(false);
    }
  };

  const handleMetaTestSend = async () => {
    setMetaSending(true);
    setMetaError('');
    setMetaMessage('');
    try {
      await sendMetaTestTemplate({
        to: testTo,
        templateName: testTemplateName,
        languageCode: testLanguageCode,
      });
      setMetaMessage('Test template sent.');
    } catch (e) {
      setMetaError(e.message || 'Test send failed');
    } finally {
      setMetaSending(false);
    }
  };

  const metaWebhookFull = webhookFullUrl('/api/webhook/meta');

  return (
    <div className="settings-page">
      <div className="settings-page__header">
        <h1>Settings</h1>
        {SHOW_GREEN_INSTANCES ? (
          <Button type="button" className="ui-button--inline" onClick={openCreate}>
            Add new instance
          </Button>
        ) : null}
      </div>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>

      </p>

      <Card>
        <h2 style={{ marginTop: 0, marginBottom: '0.35rem' }}>Meta WhatsApp</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Outbound templates only — inbound replies are not processed
        </p>

        {metaLoading ? <p style={{ color: 'var(--text-muted)' }}>Loading Meta config…</p> : null}
        {metaError ? <div className="alert-error" style={{ marginBottom: '0.75rem' }}>{metaError}</div> : null}
        {metaMessage ? (
          <div
            style={{
              marginBottom: '0.75rem',
              padding: '0.6rem 0.85rem',
              borderRadius: 8,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
            }}
          >
            {metaMessage}
          </div>
        ) : null}

        {!metaLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', maxWidth: 560 }}>
            <div>
              <label className="ui-input-label" htmlFor="meta-display-name">
                Display name
              </label>
              <input
                id="meta-display-name"
                className="ui-input-field"
                value={metaForm.displayName}
                onChange={handleMetaField('displayName')}
                placeholder="Maisie griffin"
              />
            </div>
            <div>
              <label className="ui-input-label" htmlFor="meta-phone-number-id">
                Phone number ID
              </label>
              <input
                id="meta-phone-number-id"
                className="ui-input-field"
                value={metaForm.phoneNumberId}
                onChange={handleMetaField('phoneNumberId')}
                placeholder="1211363215397026"
              />
            </div>
            <div>
              <label className="ui-input-label" htmlFor="meta-access-token">
                Access token
              </label>
              <input
                id="meta-access-token"
                className="ui-input-field"
                type="password"
                autoComplete="new-password"
                value={metaForm.accessToken}
                onChange={handleMetaField('accessToken')}
                placeholder={metaHasToken ? `Saved: ${metaTokenMasked || '••••'}` : 'Paste permanent token'}
              />
              {metaHasToken && !metaForm.accessToken ? (
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Leave blank to keep the existing token.
                </p>
              ) : null}
            </div>
            <div>
              <label className="ui-input-label" htmlFor="meta-waba-id">
                WABA ID (optional)
              </label>
              <input
                id="meta-waba-id"
                className="ui-input-field"
                value={metaForm.wabaId}
                onChange={handleMetaField('wabaId')}
                placeholder="1573026657567931"
              />
            </div>
            <div>
              <label className="ui-input-label" htmlFor="meta-graph-version">
                Graph API version (optional)
              </label>
              <input
                id="meta-graph-version"
                className="ui-input-field"
                value={metaForm.graphVersion}
                onChange={handleMetaField('graphVersion')}
                placeholder={metaDefaultGraphVersion}
              />
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={metaForm.isEnabled} onChange={handleMetaField('isEnabled')} />
              <span style={{ fontSize: '0.875rem' }}>Enabled</span>
            </label>

            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Webhook (stub): <code>{metaWebhookFull || '/api/webhook/meta'}</code>
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              <Button type="button" className="ui-button--inline" onClick={handleMetaSave} disabled={metaSaving}>
                {metaSaving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                type="button"
                className="ui-button--inline ui-button--secondary"
                onClick={handleMetaTestConnection}
                disabled={metaTesting || metaSaving}
              >
                {metaTesting ? 'Testing…' : 'Test connection'}
              </Button>
            </div>

            <div
              style={{
                marginTop: '0.5rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <strong style={{ fontSize: '0.9rem' }}>Send test template</strong>
              <div>
                <label className="ui-input-label" htmlFor="meta-test-to">
                  To (E.164 digits)
                </label>
                <input
                  id="meta-test-to"
                  className="ui-input-field"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="447911123456"
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 160px' }}>
                  <label className="ui-input-label" htmlFor="meta-test-template">
                    Template name
                  </label>
                  <input
                    id="meta-test-template"
                    className="ui-input-field"
                    value={testTemplateName}
                    onChange={(e) => setTestTemplateName(e.target.value)}
                    placeholder="hello_world"
                  />
                </div>
                <div style={{ flex: '0 1 120px' }}>
                  <label className="ui-input-label" htmlFor="meta-test-lang">
                    Language
                  </label>
                  <input
                    id="meta-test-lang"
                    className="ui-input-field"
                    value={testLanguageCode}
                    onChange={(e) => setTestLanguageCode(e.target.value)}
                    placeholder="en_GB"
                  />
                </div>
              </div>
              <div>
                <Button
                  type="button"
                  className="ui-button--inline ui-button--secondary"
                  onClick={handleMetaTestSend}
                  disabled={metaSending || metaSaving}
                >
                  {metaSending ? 'Sending…' : 'Send test template'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      {SHOW_GREEN_INSTANCES ? (
        <>
      <div style={{ marginTop: '1.5rem' }} />
      {error ? <div className="alert-error" style={{ marginBottom: '1rem' }}>{error}</div> : null}

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : instances.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            No instances yet. Click <strong>Add new instance</strong> to add your Green API credentials.
          </p>
        </Card>
      ) : (
        <div className="settings-instances-grid">
          {instances.map((inst) => (
            <Card key={inst.id} className="settings-instance-card">
              <div className="settings-instance-card__header">
                <h2 className="settings-instance-card__title">{inst.name}</h2>
                <div className="settings-instance-card__actions">
                  <button
                    type="button"
                    className="settings-instance-card__icon-btn"
                    onClick={() => openEdit(inst.id)}
                    aria-label={`Edit ${inst.name}`}
                    title="Edit"
                  >
                    <IconEdit />
                  </button>
                  <button
                    type="button"
                    className="settings-instance-card__icon-btn settings-instance-card__icon-btn--danger"
                    onClick={() => handleDelete(inst.id, inst.name)}
                    aria-label={`Delete ${inst.name}`}
                    title="Delete"
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
              <p className="settings-instance-card__meta">
                <span className="settings-instance-card__label">Phone</span> {inst.phoneNumber || '—'}
              </p>
              <p className="settings-instance-card__meta">
                <span className="settings-instance-card__label">Green instance ID</span>{' '}
                <code className="settings-instance-card__code">{inst.greenInstanceId}</code>
              </p>
              <p className="settings-instance-card__meta">
                <span className="settings-instance-card__label">Token</span> {inst.apiTokenMasked}
              </p>
              <p className="settings-instance-card__meta">
                <span className="settings-instance-card__label">Status</span>{' '}
                <AuthStatusBadge authStatus={inst.authStatus} />
                {inst.statusCheckedAt && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 8 }}>
                    checked {new Date(inst.statusCheckedAt).toLocaleTimeString()}
                  </span>
                )}
              </p>
              <p className="settings-instance-card__meta">
                <span className="settings-instance-card__label">Use in campaigns</span>{' '}
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!inst.manualDisabled}
                    onChange={() => handleToggleActive(inst)}
                  />
                  <span style={{ fontSize: '0.85rem', color: inst.manualDisabled ? 'var(--text-muted)' : 'inherit' }}>
                    {inst.manualDisabled ? 'Disabled' : 'Enabled'}
                  </span>
                </label>
              </p>
              <p className="settings-instance-card__webhook">
                <span className="settings-instance-card__label">Webhook path</span>
                <code className="settings-instance-card__code">
                  POST {inst.webhookPath || `/api/webhook/greenapi/${inst.id}`}
                </code>
              </p>
              <div className="settings-instance-card__webhook-actions">
                <Button
                  type="button"
                  className="ui-button--inline ui-button--secondary"
                  onClick={async () => {
                    const path = inst.webhookPath || `/api/webhook/greenapi/${inst.id}`;
                    const full = webhookFullUrl(path);
                    const text = full || `https://<PUBLIC_HOST>${path}`;
                    try {
                      await navigator.clipboard.writeText(full || path);
                      setCopiedId(inst.id);
                      setTimeout(() => setCopiedId(null), 2000);
                    } catch {
                      window.prompt('Copy webhook URL (set VITE_PUBLIC_WEBHOOK_BASE_URL for full URL):', text);
                    }
                  }}
                >
                  {copiedId === inst.id ? 'Copied' : 'Copy webhook URL'}
                </Button>
                <Button
                  type="button"
                  className="ui-button--inline ui-button--secondary"
                  onClick={() => handleRefreshStatus(inst.id)}
                >
                  Refresh Status
                </Button>
                {!webhookFullUrl(inst.webhookPath || `/api/webhook/greenapi/${inst.id}`) ? (
                  <span className="settings-instance-card__webhook-note">

                  </span>
                ) : (
                  <code className="settings-instance-card__code settings-instance-card__code--block">
                    {webhookFullUrl(inst.webhookPath || `/api/webhook/greenapi/${inst.id}`)}
                  </code>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
        </>
      ) : null}

      <GreenInstanceModal
        open={modalOpen}
        editingId={editingId}
        onClose={closeModal}
        onSaved={load}
      />
    </div>
  );
}
