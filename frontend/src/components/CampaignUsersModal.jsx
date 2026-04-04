import { useEffect, useRef, useState } from 'react';
import Button from './ui/Button';
import { listCampaignContacts } from '../api';

const PAGE_SIZE = 50;

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

function ContactStatusBadge({ status }) {
  const s = String(status || '').toLowerCase();
  const map = {
    sent: 'campaign-users-modal__badge campaign-users-modal__badge--sent',
    pending: 'campaign-users-modal__badge campaign-users-modal__badge--pending',
    failed: 'campaign-users-modal__badge campaign-users-modal__badge--failed',
    skipped: 'campaign-users-modal__badge campaign-users-modal__badge--skipped',
  };
  const label = status || '—';
  return <span className={map[s] || 'campaign-users-modal__badge campaign-users-modal__badge--muted'}>{label}</span>;
}

/**
 * Mounted only while open; parent should set key={campaignId} to reset pagination per campaign.
 * @param {{ campaignId: string, onClose: () => void }} props
 */
export default function CampaignUsersModal({ campaignId, onClose }) {
  const dialogRef = useRef(null);
  const modalRef = useRef(null);
  const [page, setPage] = useState(1);
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();
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
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await listCampaignContacts(campaignId, { page, limit: PAGE_SIZE });
        if (cancelled) return;
        setContacts(Array.isArray(data?.contacts) ? data.contacts : []);
        setTotal(Number(data?.total) || 0);
        setTotalPages(Math.max(1, Number(data?.totalPages) || 1));
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load recipients.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, page]);

  const titleId = 'campaign-users-modal-title';
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <dialog
      ref={dialogRef}
      className="campaign-users-modal"
      aria-labelledby={titleId}
    >
      <div ref={modalRef} className="campaign-users-modal__inner">
        <h2 id={titleId} className="campaign-users-modal__title">
          Campaign recipients
        </h2>
        <p className="campaign-users-modal__hint">
          <code className="campaign-users-modal__code">{campaignId}</code>
        </p>

        {error ? <div className="alert-error campaign-users-modal__error">{error}</div> : null}

        {loading ? <p className="muted campaign-users-modal__loading">Loading…</p> : null}

        {!loading && !error && contacts.length === 0 ? (
          <p className="muted">No contacts for this campaign.</p>
        ) : null}

        {contacts.length > 0 ? (
          <div className="campaign-users-modal__table-scroll">
            <table className="campaign-users-modal__table">
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Sent at</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <code className="campaign-users-modal__phone">{row.phoneNormalized || '—'}</code>
                    </td>
                    <td>
                      <ContactStatusBadge status={row.firstSendStatus} />
                    </td>
                    <td>{formatDt(row.sentAt)}</td>
                    <td className="campaign-users-modal__err-cell">{row.lastError || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {total > 0 ? (
          <div className="campaign-users-modal__pager">
            <span className="campaign-users-modal__pager-meta">
              {total} contact{total === 1 ? '' : 's'} · Page {page} / {totalPages}
            </span>
            <div className="campaign-users-modal__pager-actions">
              <Button
                type="button"
                className="ui-button--inline ui-button--secondary"
                disabled={loading || !canPrev}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                className="ui-button--inline ui-button--secondary"
                disabled={loading || !canNext}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}

        <div className="campaign-users-modal__actions">
          <Button type="button" className="ui-button--inline ui-button--secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
