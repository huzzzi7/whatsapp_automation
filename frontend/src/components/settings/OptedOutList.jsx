import { useCallback, useEffect, useState } from 'react';
import Button from '../ui/Button';
import { listOptedOutContacts, removeOptOut } from '../../api';

function formatDt(value) {
  if (value == null) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  } catch {
    return '—';
  }
}

export default function OptedOutList() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [removingPhone, setRemovingPhone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listOptedOutContacts();
      setContacts(list);
    } catch (e) {
      setError(e.message || 'Failed to load opted-out contacts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRemove = async (phone) => {
    if (!window.confirm(`Opt "${phone}" back in? They will start receiving campaign messages again.`)) return;
    setError('');
    setMessage('');
    setRemovingPhone(phone);
    try {
      await removeOptOut(phone);
      setMessage(`${phone} opted back in.`);
      await load();
    } catch (e) {
      setError(e.message || 'Failed to opt back in');
    } finally {
      setRemovingPhone('');
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
        <p style={{ color: 'var(--text-muted)' }}>Loading opted-out contacts…</p>
      ) : contacts.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No contacts have opted out.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.4rem 0.6rem' }}>Phone</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Opted out</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Source</th>
                <th style={{ padding: '0.4rem 0.6rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.phoneNormalized} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.4rem 0.6rem' }}>
                    <code>{c.phoneNormalized}</code>
                  </td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>{formatDt(c.optedOutAt)}</td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>{c.source === 'button' ? 'Opt-out button' : 'Keyword'}</td>
                  <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' }}>
                    <Button
                      type="button"
                      className="ui-button--inline ui-button--secondary"
                      onClick={() => handleRemove(c.phoneNormalized)}
                      disabled={removingPhone === c.phoneNormalized}
                    >
                      {removingPhone === c.phoneNormalized ? 'Opting in…' : 'Opt back in'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
