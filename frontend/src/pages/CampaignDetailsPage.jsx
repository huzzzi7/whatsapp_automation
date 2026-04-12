import { useCallback, useEffect, useState } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import CampaignUsersModal from '../components/CampaignUsersModal';
import {
  getActiveCampaigns,
  listCampaignsApi,
  pauseCampaign,
  resumeCampaign,
  startQueuedCampaign,
  stopCampaign,
  deleteCampaign,
} from '../api';

const POLL_MS = 2500;

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

function formatScheduledUk(iso) {
  if (iso == null || String(iso).trim() === '') return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
}

function ProgressBar({ percent }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="campaign-details__progress-bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div className="campaign-details__progress-fill" style={{ width: `${p}%` }} />
    </div>
  );
}

/** Progress = (sent + failed + skipped) / total; supports legacy API shape. */
function campaignProgressPercent(c) {
  const t = Number(c.totalContacts) || 0;
  if (!t) return 0;
  const sent = Number(c.sentCount) || 0;
  let failed = Number(c.failedCount);
  let skipped = Number(c.skippedCount);
  if (!Number.isFinite(failed)) failed = Number(c.failedOrSkippedCount) || 0;
  if (!Number.isFinite(skipped)) skipped = 0;
  return Math.min(100, Number((((sent + failed + skipped) / t) * 100).toFixed(2)));
}

function campaignFailedCount(c) {
  const f = Number(c.failedCount);
  if (Number.isFinite(f)) return f;
  return Number(c.failedOrSkippedCount) || 0;
}

function campaignSkippedCount(c) {
  const s = Number(c.skippedCount);
  return Number.isFinite(s) ? s : 0;
}

function StatusBadge({ status }) {
  const s = String(status || '').toLowerCase();
  const map = {
    running: 'campaign-details__badge campaign-details__badge--running',
    paused: 'campaign-details__badge campaign-details__badge--paused',
    queued: 'campaign-details__badge campaign-details__badge--queued',
    completed: 'campaign-details__badge campaign-details__badge--completed',
    failed: 'campaign-details__badge campaign-details__badge--failed',
    cancelled: 'campaign-details__badge campaign-details__badge--muted',
    stopped: 'campaign-details__badge campaign-details__badge--muted',
  };
  return <span className={map[s] || 'campaign-details__badge campaign-details__badge--muted'}>{status || '—'}</span>;
}

function CampaignTitle({ c }) {
  const label =
    c.displayName ||
    (c.name && String(c.name).trim() ? c.name : `Campaign ${String(c.id || '').slice(0, 6)}`);
  return (
    <div className="campaign-details__title-row">
      <strong className="campaign-details__title">{label}</strong>
      <code className="campaign-details__id">{c.id}</code>
    </div>
  );
}

function IconEye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ViewUsersButton({ campaignId, onView }) {
  return (
    <button
      type="button"
      className="campaign-details__icon-btn"
      title="View users"
      aria-label="View users"
      onClick={() => onView(campaignId)}
    >
      <IconEye />
    </button>
  );
}

/**
 * Prefer non-empty `runningAll`; if API sends `runningAll: []` but legacy `running` is set, use `running`.
 * Avoids treating "no runnings" when one campaign is actually running (mis-synced payloads).
 */
function normalizeRunningAll(data) {
  const runningAll = Array.isArray(data?.runningAll) ? data.runningAll : null;
  if (runningAll && runningAll.length > 0) return runningAll;
  if (data?.running) return [data.running];
  return runningAll || [];
}

function instanceHasRunning(runningAll, greenInstanceId) {
  const gid = String(greenInstanceId ?? '').trim();
  if (!gid) return false;
  return runningAll.some((r) => String(r?.greenInstanceId ?? '').trim() === gid);
}

export default function CampaignDetailsPage() {
  const [active, setActive] = useState({ runningAll: [], paused: [], queued: [] });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmStopId, setConfirmStopId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);

  const handleViewUsers = useCallback((id) => {
    setSelectedCampaignId(id);
  }, []);

  const loadActive = useCallback(async () => {
    try {
      const data = await getActiveCampaigns();
      setActive({
        runningAll: normalizeRunningAll(data),
        paused: Array.isArray(data?.paused) ? data.paused : [],
        queued: Array.isArray(data?.queued) ? data.queued : [],
      });
      setError('');
    } catch (e) {
      setError(e?.message || 'Failed to load active campaigns.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await listCampaignsApi();
      setHistory(Array.isArray(data?.campaigns) ? data.campaigns : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActive();
    loadHistory();
  }, [loadActive, loadHistory]);

  const shouldPoll =
    (Array.isArray(active.runningAll) && active.runningAll.length > 0) ||
    (Array.isArray(active.paused) && active.paused.length > 0) ||
    (Array.isArray(active.queued) && active.queued.length > 0);

  useEffect(() => {
    if (!shouldPoll) return undefined;
    const id = setInterval(() => {
      loadActive();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [shouldPoll, loadActive]);

  useEffect(() => {
    if (!confirmStopId && !confirmDeleteId) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setConfirmStopId(null);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmStopId, confirmDeleteId]);

  const runningList = active.runningAll || [];
  const pausedList = active.paused || [];
  const queuedList = active.queued || [];

  const hasActiveData =
    (Array.isArray(active?.runningAll) && active.runningAll.length > 0) ||
    (Array.isArray(active?.paused) && active.paused.length > 0) ||
    (Array.isArray(active?.queued) && active.queued.length > 0);

  const handlePause = async (id) => {
    setActionBusy(true);
    try {
      await pauseCampaign(id);
      await loadActive();
      await loadHistory();
    } catch (e) {
      setError(e?.message || 'Pause failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleResume = async (id) => {
    setActionBusy(true);
    try {
      await resumeCampaign(id);
      await loadActive();
      await loadHistory();
    } catch (e) {
      setError(e?.message || 'Resume failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleStartQueued = async (id) => {
    setActionBusy(true);
    try {
      await startQueuedCampaign(id);
      await loadActive();
      await loadHistory();
    } catch (e) {
      setError(e?.message || 'Start failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleStop = async (id) => {
    setActionBusy(true);
    try {
      await stopCampaign(id);
      await loadActive();
      await loadHistory();
      setError('');
    } catch (e) {
      setError(e?.message || 'Stop failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async (id) => {
    setActionBusy(true);
    try {
      await deleteCampaign(id);
      if (selectedCampaignId === id) setSelectedCampaignId(null);
      await loadActive();
      await loadHistory();
      setError('');
    } catch (e) {
      setError(e?.message || 'Delete failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const renderRunningCards = () =>
    runningList.map((c) => (
      <div key={c.id} className="campaign-details__active-card">
        <div className="campaign-details__card-head">
          <CampaignTitle c={c} />
          <ViewUsersButton campaignId={c.id} onView={handleViewUsers} />
        </div>
        <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <StatusBadge status={c.status} />
          <span className="campaign-details__queue-meta">
            Instance <code className="campaign-details__table-id">{c.greenInstanceId || '—'}</code>
          </span>
        </div>
        <p className="campaign-details__stats" style={{ marginTop: '0.75rem' }}>
          Sent <strong>{c.sentCount}</strong>
          {' · '}
          Failed <strong>{campaignFailedCount(c)}</strong>
          {' · '}
          Skipped <strong>{campaignSkippedCount(c)}</strong>
          {' · '}
          Total <strong>{c.totalContacts}</strong>
          {' · '}
          Remaining <strong>{c.remaining}</strong>
        </p>
        <ProgressBar percent={campaignProgressPercent(c)} />
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            type="button"
            className="ui-button--inline"
            onClick={() => handlePause(c.id)}
            disabled={actionBusy || c.status !== 'running'}
          >
            Pause
          </Button>
          <Button
            type="button"
            className="ui-button--inline ui-button--secondary campaign-details__btn-stop"
            onClick={() => setConfirmStopId(c.id)}
            disabled={actionBusy}
          >
            Stop
          </Button>
        </div>
      </div>
    ));

  const renderPausedCards = () =>
    pausedList.map((c) => {
      const blocked = instanceHasRunning(runningList, c.greenInstanceId);
      return (
        <div key={c.id} className="campaign-details__active-card campaign-details__active-card--secondary">
          <div className="campaign-details__card-head">
            <CampaignTitle c={c} />
            <ViewUsersButton campaignId={c.id} onView={handleViewUsers} />
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <StatusBadge status={c.status} />
            <span className="campaign-details__queue-meta"> Queue order #{c.queueOrder}</span>
          </div>
          <p className="campaign-details__stats" style={{ marginTop: '0.5rem' }}>
            Sent {c.sentCount} · Failed {campaignFailedCount(c)} · Skipped {campaignSkippedCount(c)} · Total{' '}
            {c.totalContacts} · Remaining {c.remaining}
          </p>
          <ProgressBar percent={campaignProgressPercent(c)} />
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              type="button"
              className="ui-button--inline"
              onClick={() => handleResume(c.id)}
              disabled={actionBusy || blocked}
            >
              Resume
            </Button>
            <Button
              type="button"
              className="ui-button--inline ui-button--secondary campaign-details__btn-stop"
              onClick={() => setConfirmStopId(c.id)}
              disabled={actionBusy}
            >
              Stop
            </Button>
            {blocked ? (
              <span className="campaign-details__hint" style={{ marginLeft: '0.5rem' }}>
                Another campaign is running on this instance.
              </span>
            ) : null}
          </div>
        </div>
      );
    });

  const showActiveCard = loading || hasActiveData;

  return (
    <div className="campaign-details-page">
      <h1 style={{ marginBottom: '0.5rem' }}>Campaign Details</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        Live queue, running and paused campaigns, and full history.
      </p>

      {error ? <div className="alert-error" style={{ marginBottom: '1rem' }}>{error}</div> : null}

      <div className="campaign-details__grid">
        {showActiveCard ? (
          <Card className="campaign-details__section">
            <h2 className="campaign-details__section-title">Live campaigns</h2>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <>
                {runningList.length > 0 ? (
                  <div className="campaign-section">
                    <h3 className="campaign-section__title">Active campaigns</h3>
                    <div className="campaign-section__body">{renderRunningCards()}</div>
                  </div>
                ) : null}
                {pausedList.length > 0 ? (
                  <div className="campaign-section">
                    <h3 className="campaign-section__title">Paused campaigns</h3>
                    <div className="campaign-section__body">{renderPausedCards()}</div>
                  </div>
                ) : null}
                {queuedList.length > 0 ? (
                  <div className="campaign-section">
                    <h3 className="campaign-section__title">Queued campaigns</h3>
                    <ul className="campaign-details__queue-list campaign-section__body">
                      {queuedList.map((c) => {
                        const startBlocked = instanceHasRunning(runningList, c.greenInstanceId);
                        return (
                          <li key={c.id} className="campaign-details__queue-item">
                            <div>
                              <CampaignTitle c={c} />
                              <div className="campaign-details__queue-meta">
                                <StatusBadge status="queued" /> Order #{c.queueOrder}
                              </div>
                              {c.status === 'queued' && c.scheduledAt ? (
                                <p className="campaign-details__hint" style={{ marginTop: '0.35rem' }}>
                                  Scheduled for: {formatScheduledUk(c.scheduledAt)}
                                </p>
                              ) : null}
                              {startBlocked ? (
                                <p className="campaign-details__hint" style={{ marginTop: '0.35rem' }}>
                                  Start blocked: a campaign is already running on this instance.
                                </p>
                              ) : null}
                            </div>
                            <div className="campaign-details__queue-actions">
                              <ViewUsersButton campaignId={c.id} onView={handleViewUsers} />
                              <Button
                                type="button"
                                className="ui-button--inline ui-button--secondary campaign-details__btn-stop"
                                onClick={() => setConfirmStopId(c.id)}
                                disabled={actionBusy}
                              >
                                Stop
                              </Button>
                              <Button
                                type="button"
                                className="ui-button--inline ui-button--secondary"
                                onClick={() => handleStartQueued(c.id)}
                                disabled={actionBusy || startBlocked}
                              >
                                Start
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        ) : null}

        <Card className="campaign-details__section">
          <h2 className="campaign-details__section-title">Campaign history</h2>
          {historyLoading ? (
            <p className="muted">Loading…</p>
          ) : history.length === 0 ? (
            <p className="campaign-details__empty">No campaigns yet</p>
          ) : (
            <div className="campaign-details__table-wrap">
              <table className="campaign-details__table">
                <thead>
                  <tr>
                    <th>Campaign name</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Sent</th>
                    <th>Failed</th>
                    <th>Skipped</th>
                    <th>Created</th>
                    <th>Completed</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="campaign-details__history-name">{c.displayName || c.name || `Campaign ${String(c.id || '').slice(0, 6)}`}</div>
                        <small className="campaign-details__history-id">{c.id}</small>
                      </td>
                      <td>
                        <StatusBadge status={c.status} />
                        {c.status === 'queued' && c.scheduledAt ? (
                          <div className="campaign-details__hint" style={{ marginTop: '0.35rem' }}>
                            Scheduled for: {formatScheduledUk(c.scheduledAt)}
                          </div>
                        ) : null}
                      </td>
                      <td>{c.totalContacts}</td>
                      <td>{c.sentCount}</td>
                      <td>{campaignFailedCount(c)}</td>
                      <td>{campaignSkippedCount(c)}</td>
                      <td>{formatDt(c.createdAt)}</td>
                      <td>{formatDt(c.completedAt)}</td>
                      <td className="campaign-details__history-actions">
                        <div className="campaign-details__history-actions-inner">
                          <ViewUsersButton campaignId={c.id} onView={handleViewUsers} />
                          <button
                            type="button"
                            className="btn-delete"
                            disabled={c.status === 'running' || actionBusy}
                            title={
                              c.status === 'running'
                                ? 'Stop the campaign before deleting.'
                                : 'Delete campaign permanently'
                            }
                            onClick={() => setConfirmDeleteId(c.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {selectedCampaignId ? (
        <CampaignUsersModal
          key={selectedCampaignId}
          campaignId={selectedCampaignId}
          onClose={() => setSelectedCampaignId(null)}
        />
      ) : null}

      {confirmStopId ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => setConfirmStopId(null)}
        >
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="campaign-stop-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="campaign-stop-modal-title" className="modal-title">
                Stop campaign
              </h3>
              <button type="button" className="modal-close" aria-label="Close" onClick={() => setConfirmStopId(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to stop this campaign?</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setConfirmStopId(null)}>
                No
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={actionBusy}
                onClick={() => {
                  const id = confirmStopId;
                  setConfirmStopId(null);
                  void handleStop(id);
                }}
              >
                Yes, stop
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDeleteId ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="campaign-delete-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="campaign-delete-modal-title" className="modal-title">
                Delete campaign
              </h3>
              <button type="button" className="modal-close" aria-label="Close" onClick={() => setConfirmDeleteId(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this campaign? This action cannot be undone.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={actionBusy}
                onClick={() => {
                  const id = confirmDeleteId;
                  setConfirmDeleteId(null);
                  void handleDelete(id);
                }}
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
