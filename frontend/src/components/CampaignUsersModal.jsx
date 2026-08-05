import { useEffect, useRef, useState } from 'react';
import Button from './ui/Button';
import { listCampaignContacts, sendConversationMessage } from '../api';

const PAGE_SIZE = 50;

const DELIVERY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'sent', label: 'Sent' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'read', label: 'Read' },
  { value: 'failed', label: 'Failed' },
];

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

function DeliveryStatusBadge({ status, error }) {
  const s = String(status || '').toLowerCase();
  if (!s) return <span className="campaign-users-modal__badge campaign-users-modal__badge--muted">—</span>;
  const map = {
    sent: 'campaign-users-modal__badge campaign-users-modal__badge--sent',
    delivered: 'campaign-users-modal__badge campaign-users-modal__badge--delivered',
    read: 'campaign-users-modal__badge campaign-users-modal__badge--read',
    failed: 'campaign-users-modal__badge campaign-users-modal__badge--failed',
  };
  return (
    <span
      className={map[s] || 'campaign-users-modal__badge campaign-users-modal__badge--muted'}
      title={s === 'failed' && error ? error : undefined}
    >
      {status}
    </span>
  );
}

/** Inline quick-reply box for a single contact row; owns its own text/sending state. */
function ReplyCell({ phone }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    setError('');
    try {
      await sendConversationMessage(phone, { text: text.trim() });
      setText('');
      setSent(true);
      setTimeout(() => setSent(false), 2000);
    } catch (e) {
      setError(e.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 180 }}>
      <input
        className="ui-input-field"
        style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Reply…"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSend();
          }
        }}
        title={error || undefined}
      />
      <Button
        type="button"
        className="ui-button--inline ui-button--secondary"
        style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
        onClick={handleSend}
        disabled={sending || !text.trim()}
      >
        {sending ? '…' : sent ? '✓' : 'Send'}
      </Button>
    </div>
  );
}

/**
 * Mounted only while open; parent should set key={campaignId} to reset pagination per campaign.
 * @param {{ campaignId: string, onClose: () => void }} props
 */
export default function CampaignUsersModal({ campaignId, onClose }) {
  const dialogRef = useRef(null);
  const modalRef = useRef(null);
  const [page, setPage] = useState(1);
  const [deliveryFilter, setDeliveryFilter] = useState('');
  const [repliedFilter, setRepliedFilter] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [overallTotal, setOverallTotal] = useState(0);
  const [repliedCount, setRepliedCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [statusCounts, setStatusCounts] = useState({ sent: 0, delivered: 0, read: 0, failed: 0 });
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
        const data = await listCampaignContacts(campaignId, {
          page,
          limit: PAGE_SIZE,
          deliveryStatus: deliveryFilter,
          hasReplied: repliedFilter,
        });
        if (cancelled) return;
        setContacts(Array.isArray(data?.contacts) ? data.contacts : []);
        setTotal(Number(data?.total) || 0);
        setOverallTotal(Number(data?.overallTotal) || 0);
        setRepliedCount(Number(data?.repliedCount) || 0);
        setTotalPages(Math.max(1, Number(data?.totalPages) || 1));
        setStatusCounts({
          sent: Number(data?.statusCounts?.sent) || 0,
          delivered: Number(data?.statusCounts?.delivered) || 0,
          read: Number(data?.statusCounts?.read) || 0,
          failed: Number(data?.statusCounts?.failed) || 0,
        });
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load recipients.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, page, deliveryFilter, repliedFilter]);

  const titleId = 'campaign-users-modal-title';
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const filterCounts = {
    '': overallTotal,
    sent: statusCounts.sent,
    delivered: statusCounts.delivered,
    read: statusCounts.read,
    failed: statusCounts.failed,
  };

  const handleFilterClick = (value) => {
    if (value === deliveryFilter) return;
    setDeliveryFilter(value);
    setPage(1);
  };

  const handleRepliedToggle = () => {
    setRepliedFilter((v) => !v);
    setPage(1);
  };

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
          {' · '}
          {repliedCount} contact{repliedCount === 1 ? '' : 's'} replied
        </p>

        <div className="campaign-users-modal__filters" role="tablist" aria-label="Filter by delivery status">
          {DELIVERY_FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              role="tab"
              aria-selected={deliveryFilter === f.value}
              className={
                deliveryFilter === f.value
                  ? 'campaign-users-modal__filter campaign-users-modal__filter--active'
                  : 'campaign-users-modal__filter'
              }
              onClick={() => handleFilterClick(f.value)}
              disabled={loading}
            >
              {f.label} <span className="campaign-users-modal__filter-count">{filterCounts[f.value]}</span>
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={repliedFilter}
            className={
              repliedFilter
                ? 'campaign-users-modal__filter campaign-users-modal__filter--active'
                : 'campaign-users-modal__filter'
            }
            onClick={handleRepliedToggle}
            disabled={loading}
          >
            Replied <span className="campaign-users-modal__filter-count">{repliedCount}</span>
          </button>
        </div>

        {error ? <div className="alert-error campaign-users-modal__error">{error}</div> : null}

        {loading ? <p className="muted campaign-users-modal__loading">Loading…</p> : null}

        {!loading && !error && contacts.length === 0 ? (
          <p className="muted">No contacts match this filter.</p>
        ) : null}

        {contacts.length > 0 ? (
          <div className="campaign-users-modal__table-scroll">
            <table className="campaign-users-modal__table">
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Delivery</th>
                  <th>Sent at</th>
                  <th>Replies</th>
                  <th>Last reply</th>
                  <th>Reply</th>
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
                    <td>
                      <DeliveryStatusBadge status={row.metaDeliveryStatus} error={row.metaDeliveryError} />
                    </td>
                    <td>{formatDt(row.sentAt)}</td>
                    <td>{row.replyCount > 0 ? row.replyCount : '—'}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.lastReplyPreview || '—'}
                    </td>
                    <td>
                      <ReplyCell phone={row.phoneNormalized} />
                    </td>
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
