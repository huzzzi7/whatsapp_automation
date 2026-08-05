import { useState, useEffect, useCallback } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import MetaTemplateManager from '../components/settings/MetaTemplateManager';
import OptedOutList from '../components/settings/OptedOutList';
import UniversityLinkManager from '../components/settings/UniversityLinkManager';
import {
  getMetaConfig,
  updateMetaConfig,
  testMetaConnection,
  sendMetaTestTemplate,
} from '../api';

const EMPTY_META_FORM = {
  displayName: '',
  phoneNumberId: '',
  accessToken: '',
  wabaId: '',
  graphVersion: '',
  isEnabled: true,
};

export default function SettingsPage() {
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
    loadMeta();
  }, [loadMeta]);

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

  return (
    <div className="settings-page">
      <div className="settings-page__header">
        <h1>Settings</h1>
      </div>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>

      </p>

      <Card>
        <h2 style={{ marginTop: 0, marginBottom: '0.35rem' }}>Meta WhatsApp</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Sends approved templates; inbound replies are checked for opt-out requests automatically
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

      <div style={{ marginTop: '1.5rem' }} />

      <Card>
        <h2 style={{ marginTop: 0, marginBottom: '0.35rem' }}>Meta Templates</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Register the exact template name and variable names Meta approved, then pick one per campaign in the Wizard.
        </p>
        <MetaTemplateManager />
      </Card>

      <div style={{ marginTop: '1.5rem' }} />

      <Card>
        <h2 style={{ marginTop: 0, marginBottom: '0.35rem' }}>Opted-out contacts</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Contacts who tapped the opt-out button or replied STOP/unsubscribe. They're automatically
          excluded from new campaign uploads and from sending.
        </p>
        <OptedOutList />
      </Card>

      <div style={{ marginTop: '1.5rem' }} />

      <Card>
        <h2 style={{ marginTop: 0, marginBottom: '0.35rem' }}>University links</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Used when a contact says they're going to a different university — the reply sequence
          matches their answer against this list and sends the right group link automatically.
        </p>
        <UniversityLinkManager />
      </Card>
    </div>
  );
}
