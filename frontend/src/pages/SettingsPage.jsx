import { useState, useEffect, useCallback } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import GreenInstanceModal from '../components/settings/GreenInstanceModal';
import { listGreenInstances, deleteGreenInstance } from '../api';

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

export default function SettingsPage() {
  const [instances, setInstances] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

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

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <div className="settings-page">
      <div className="settings-page__header">
        <h1>Settings</h1>
        <Button type="button" className="ui-button--inline" onClick={openCreate}>
          Add new instance
        </Button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        
      </p>

      {error ? <div className="alert-error" style={{ marginBottom: '1rem' }}>{error}</div> : null}

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : instances.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            No instances yet. Click <strong>Add new instance</strong> or run <code>npx prisma db seed</code> if{' '}
            <code>GREENAPI_INSTANCE</code> and <code>GREENAPI_TOKEN</code> are set in <code>.env</code>.
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

      <GreenInstanceModal
        open={modalOpen}
        editingId={editingId}
        onClose={closeModal}
        onSaved={load}
      />
    </div>
  );
}
