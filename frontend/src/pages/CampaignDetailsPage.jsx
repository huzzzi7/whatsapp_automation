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
  };
  return <span className={map[s] || 'campaign-details__badge campaign-details__badge--muted'}>{status || '—'}</span>;
}

function CampaignTitle({ c }) {
  const label = c.name && String(c.name).trim() ? c.name : c.id;
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

  const renderRunningCards = () => {
    if (!runningList.length) {
      return <p className="campaign-details__empty">No running campaigns</p>;
    }
    return runningList.map((c) => (
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
        <div style={{ marginTop: '1rem' }}>
          <Button
            type="button"
            className="ui-button--inline"
            onClick={() => handlePause(c.id)}
            disabled={actionBusy || c.status !== 'running'}
          >
            Pause
          </Button>
        </div>
      </div>
    ));
  };

  const renderPausedCards = () => {
    if (!pausedList.length) {
      return <p className="campaign-details__empty muted">No paused campaigns</p>;
    }
    return pausedList.map((c) => {
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
          <div style={{ marginTop: '0.75rem' }}>
            <Button
              type="button"
              className="ui-button--inline"
              onClick={() => handleResume(c.id)}
              disabled={actionBusy || blocked}
            >
              Resume
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
  };

  return (
    <div className="campaign-details-page">
      <h1 style={{ marginBottom: '0.5rem' }}>Campaign Details</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        Live queue, running and paused campaigns, and full history.
      </p>

      {error ? <div className="alert-error" style={{ marginBottom: '1rem' }}>{error}</div> : null}

      <div className="campaign-details__grid">
        {hasActiveData ? (
          <Card className="campaign-details__section">
            <h2 className="campaign-details__section-title">Active</h2>

            <h3 className="campaign-details__subsection-title">Running</h3>
            {loading ? <p className="muted">Loading…</p> : renderRunningCards()}

            <h3 className="campaign-details__subsection-title" style={{ marginTop: '1.5rem' }}>
              Paused
            </h3>
            {loading ? <p className="muted">Loading…</p> : renderPausedCards()}

            <h3 className="campaign-details__subsection-title" style={{ marginTop: '1.5rem' }}>
              Queue
            </h3>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : queuedList.length === 0 ? (
              <p className="campaign-details__empty">Queue is empty</p>
            ) : (
              <ul className="campaign-details__queue-list">
                {queuedList.map((c) => {
                  const startBlocked = instanceHasRunning(runningList, c.greenInstanceId);
                  if (import.meta.env.DEV) {
                    console.log('Start check:', {
                      campaignId: c.id,
                      instance: c.greenInstanceId,
                      startBlocked,
                      runningList,
                    });
                  }
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
                    <th>Campaign ID</th>
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
                        <code className="campaign-details__table-id">{c.id}</code>
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
                        <ViewUsersButton campaignId={c.id} onView={handleViewUsers} />
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
    </div>
  );
}
