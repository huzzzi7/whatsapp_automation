import { useCallback, useEffect, useState } from 'react';
import Button from '../ui/Button';
import {
  listUniversityLinks,
  createUniversityLink,
  updateUniversityLink,
  deleteUniversityLink,
} from '../../api';

const EMPTY_FORM = { universityName: '', groupLink: '', ticketLink: '' };

export default function UniversityLinkManager() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listUniversityLinks();
      setLinks(list);
    } catch (e) {
      setError(e.message || 'Failed to load university links');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (l) => {
    setEditingId(l.id);
    setForm({ universityName: l.universityName, groupLink: l.groupLink || '', ticketLink: l.ticketLink || '' });
    setMessage('');
    setError('');
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setMessage('');
    setError('');
  };

  const handleField = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        universityName: form.universityName.trim(),
        groupLink: form.groupLink.trim(),
        ticketLink: form.ticketLink.trim(),
      };
      if (!payload.universityName || (!payload.groupLink && !payload.ticketLink)) {
        setError('University name and at least one of group link / ticket link are required.');
        return;
      }
      if (editingId) {
        await updateUniversityLink(editingId, payload);
        setMessage('University link updated.');
      } else {
        await createUniversityLink(payload);
        setMessage('University link added.');
      }
      startCreate();
      await load();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (l) => {
    if (!window.confirm(`Delete the link for "${l.universityName}"?`)) return;
    setError('');
    setMessage('');
    try {
      await deleteUniversityLink(l.id);
      if (editingId === l.id) startCreate();
      await load();
    } catch (e) {
      setError(e.message || 'Delete failed');
    }
  };

  return (
    <div>
      {error ? <div className="alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div> : null}
      {message ? (
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
          {message}
        </div>
      ) : null}

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading university links…</p>
      ) : links.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No university links added yet.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.4rem 0.6rem' }}>University</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Group link</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Ticket link</th>
                <th style={{ padding: '0.4rem 0.6rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.4rem 0.6rem' }}>{l.universityName}</td>
                  <td style={{ padding: '0.4rem 0.6rem', wordBreak: 'break-all' }}>
                    {l.groupLink ? (
                      <a href={l.groupLink} target="_blank" rel="noreferrer">
                        {l.groupLink}
                      </a>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '0.4rem 0.6rem', wordBreak: 'break-all' }}>
                    {l.ticketLink ? (
                      <a href={l.ticketLink} target="_blank" rel="noreferrer">
                        {l.ticketLink}
                      </a>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' }}>
                    <Button
                      type="button"
                      className="ui-button--inline ui-button--secondary"
                      onClick={() => startEdit(l)}
                    >
                      Edit
                    </Button>{' '}
                    <Button
                      type="button"
                      className="ui-button--inline ui-button--secondary"
                      onClick={() => handleDelete(l)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div
        style={{
          maxWidth: 480,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid var(--border)',
        }}
      >
        <strong style={{ fontSize: '0.9rem' }}>{editingId ? 'Edit university link' : 'Add university link'}</strong>
        <div>
          <label className="ui-input-label" htmlFor="university-link-name">
            University name
          </label>
          <input
            id="university-link-name"
            className="ui-input-field"
            value={form.universityName}
            onChange={handleField('universityName')}
            placeholder="University of Kent"
          />
        </div>
        <div>
          <label className="ui-input-label" htmlFor="university-link-url">
            Group chat link
          </label>
          <input
            id="university-link-url"
            className="ui-input-field"
            value={form.groupLink}
            onChange={handleField('groupLink')}
            placeholder="https://chat.whatsapp.com/..."
          />
        </div>
        <div>
          <label className="ui-input-label" htmlFor="university-link-ticket">
            Ticket link
          </label>
          <input
            id="university-link-ticket"
            className="ui-input-field"
            value={form.ticketLink}
            onChange={handleField('ticketLink')}
            placeholder="https://fatso.ma/..."
          />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button type="button" className="ui-button--inline" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add link'}
          </Button>
          {editingId ? (
            <Button type="button" className="ui-button--inline ui-button--secondary" onClick={startCreate}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
