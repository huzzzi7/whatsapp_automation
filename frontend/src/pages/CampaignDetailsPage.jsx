import { useCallback, useEffect, useState } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import CampaignUsersModal from '../components/CampaignUsersModal';
import {
  getActiveCampaigns,
  getCampaignDetail,
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

function parseDaysSet(str) {
  const set = new Set();
  for (const part of String(str || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const n = Number(part);
    if (Number.isFinite(n) && n >= 0 && n <= 6) set.add(n);
  }
  return set.size ? set : new Set([1, 2, 3, 4, 5]);
}

function fmtOperationalDaysHuman(mask) {
  const days = parseDaysSet(mask);
  const hasMonFri = [1, 2, 3, 4, 5].every((d) => days.has(d)) && days.size === 5;
  if (hasMonFri) return 'Mon – Fri';
  const labels = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
  return Array.from(days.values())
    .sort((a, b) => a - b)
    .map((d) => labels[d] || String(d))
    .join(', ');
}

/** Formats DB time strings like "09:00:00" or "09:00" → "9:00 AM". */
function fmtTime(t) {
  if (t == null || String(t).trim() === '') return '—';
  const s = String(t).trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return s;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return s;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mi).padStart(2, '0')} ${ampm}`;
}

/** User-facing campaign title — never shows raw database IDs. */
function campaignDisplayLabel(c) {
  const d = c?.displayName;
  if (d != null && String(d).trim() !== '') return String(d).trim();
  const n = c?.name;
  if (n != null && String(n).trim() !== '') return String(n).trim();
  return 'Unnamed campaign';
}

function instanceDisplayLabel(c) {
  const name = c?.greenInstanceName;
  if (name != null && String(name).trim() !== '') return String(name).trim();
  return '—';
}

/** Formats date or ISO datetime → "19 May 2026". */
function fmtDate(d) {
  if (d == null || String(d).trim() === '') return '—';
  try {
    const raw = String(d).trim();
    const datePart = raw.includes('T') ? raw.split('T')[0] : raw.length >= 10 ? raw.slice(0, 10) : raw;
    const parts = datePart.split('-');
    if (parts.length === 3) {
      const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    const x = new Date(raw);
    if (!Number.isNaN(x.getTime())) {
      return x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return '—';
  } catch {
    return '—';
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

function InfoModalRow({ label, value }) {
  return (
    <div className="campaign-info-modal__row">
      <span className="campaign-info-modal__label">{label}</span>
      <span className="campaign-info-modal__value">{value}</span>
    </div>
  );
}

function CampaignInfoModal({ campaign, loading, error, onClose }) {
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal-content modal-content--campaign-info"
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-info-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="campaign-info-modal-title" className="modal-title">
            Campaign details
          </h3>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {loading ? <p className="muted">Loading…</p> : null}
          {!loading && error ? <div className="alert-error" style={{ marginBottom: '1rem' }}>{error}</div> : null}
          {!loading && !error && !campaign ? <p className="muted">No campaign data.</p> : null}
          {!loading && !error && campaign ? (
            <>
              <div className="campaign-info-modal__section">
                <div className="campaign-info-modal__section-title">Campaign info</div>
                <InfoModalRow label="Name" value={campaignDisplayLabel(campaign)} />
                <InfoModalRow
                  label="Status"
                  value={<StatusBadge status={campaign.status} />}
                />
                <InfoModalRow label="Created" value={fmtDate(campaign.createdAt)} />
                <InfoModalRow label="Started" value={fmtDate(campaign.startedAt)} />
              </div>

              <div className="campaign-info-modal__section">
                <div className="campaign-info-modal__section-title">Mode &amp; instance</div>
                <InfoModalRow
                  label="Mode"
                  value={campaign.isMultiInstance ? 'Automatic (all instances)' : 'Manual (single instance)'}
                />
                <InfoModalRow label="Instance" value={instanceDisplayLabel(campaign)} />
                {campaign.greenInstancePhone ? (
                  <InfoModalRow label="Instance phone" value={String(campaign.greenInstancePhone)} />
                ) : null}
              </div>

              <div className="campaign-info-modal__section">
                <div className="campaign-info-modal__section-title">Schedule</div>
                <InfoModalRow
                  label="Operational hours"
                  value={`${fmtTime(campaign.operationalStart)} – ${fmtTime(campaign.operationalEnd)}`}
                />
                <InfoModalRow label="Active days" value={fmtOperationalDaysHuman(campaign.operationalDays)} />
                <InfoModalRow label="Campaign end date" value={fmtDate(campaign.campaignEndDate)} />
                <InfoModalRow
                  label="Scheduled start"
                  value={campaign.scheduledAt != null && String(campaign.scheduledAt).trim() !== '' ? fmtDate(campaign.scheduledAt) : 'Immediate'}
                />
              </div>

              <div className="campaign-info-modal__section">
                <div className="campaign-info-modal__section-title">Progress</div>
                <InfoModalRow label="Total contacts" value={String(campaign.totalContacts ?? 0)} />
                <InfoModalRow label="Sent" value={String(campaign.sentCount ?? 0)} />
                <InfoModalRow label="Failed" value={String(campaignFailedCount(campaign))} />
                <InfoModalRow label="Skipped" value={String(campaignSkippedCount(campaign))} />
                <InfoModalRow label="Remaining" value={String(campaign.remaining ?? 0)} />
                <InfoModalRow
                  label="% complete"
                  value={`${campaign.percentComplete != null && Number.isFinite(Number(campaign.percentComplete)) ? campaign.percentComplete : campaignProgressPercent(campaign)}%`}
                />
                <InfoModalRow
                  label="Daily limit per instance"
                  value={campaign.dailyLimitPerInstance != null && campaign.dailyLimitPerInstance !== '' ? String(campaign.dailyLimitPerInstance) : '—'}
                />
              </div>

              {campaign.errorMessage ? (
                <div className="campaign-info-modal__section">
                  <div className="campaign-info-modal__section-title">Error</div>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--danger, #b91c1c)' }}>{campaign.errorMessage}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function IconNotepad() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

function ViewDetailsButton({ campaignId, onOpen, disabled }) {
  return (
    <button
      type="button"
      className="campaign-details__icon-btn campaign-details__icon-btn--with-label"
      title="Campaign details"
      aria-label="Campaign details"
      onClick={() => onOpen(campaignId)}
      disabled={disabled}
    >
      <IconNotepad />
      <span className="campaign-details__btn-details-label">Details</span>
    </button>
  );
}

function CampaignTitle({ c }) {
  return (
    <div className="campaign-details__title-row">
      <strong className="campaign-details__title">{campaignDisplayLabel(c)}</strong>
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

function IconTrash() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
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
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [detailsCampaign, setDetailsCampaign] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');

  const handleViewUsers = useCallback((id) => {
    setSelectedCampaignId(id);
  }, []);

  const handleCloseDetails = useCallback(() => {
    setDetailsModalOpen(false);
    setDetailsCampaign(null);
    setDetailsError('');
    setDetailsLoading(false);
  }, []);

  const handleOpenDetails = useCallback(async (id) => {
    setDetailsModalOpen(true);
    setDetailsLoading(true);
    setDetailsError('');
    setDetailsCampaign(null);
    try {
      const data = await getCampaignDetail(id);
      setDetailsCampaign(data?.campaign ?? null);
    } catch (e) {
      setDetailsError(e?.message || 'Failed to load campaign details.');
      setDetailsCampaign(null);
    } finally {
      setDetailsLoading(false);
    }
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
    if (!confirmStopId && !confirmDeleteId && !detailsModalOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setConfirmStopId(null);
        setConfirmDeleteId(null);
        if (detailsModalOpen) handleCloseDetails();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmStopId, confirmDeleteId, detailsModalOpen, handleCloseDetails]);

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
      handleCloseDetails();
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
          <div className="campaign-details__card-head-actions">
            <ViewDetailsButton campaignId={c.id} onOpen={handleOpenDetails} disabled={actionBusy} />
            <ViewUsersButton campaignId={c.id} onView={handleViewUsers} />
          </div>
        </div>
        <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <StatusBadge status={c.status} />
          <span className="campaign-details__queue-meta">
            {c.isMultiInstance ? '🔄 Automatic (all instances)' : '📱 Manual'}
            {' · '}
            {instanceDisplayLabel(c)}
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
            <div className="campaign-details__card-head-actions">
              <ViewDetailsButton campaignId={c.id} onOpen={handleOpenDetails} disabled={actionBusy} />
              <ViewUsersButton campaignId={c.id} onView={handleViewUsers} />
            </div>
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <StatusBadge status={c.status} />
            <span className="campaign-details__queue-meta"> Queue order #{c.queueOrder}</span>
          </div>
          <div style={{ marginTop: '0.35rem' }} className="campaign-details__queue-meta">
            {c.isMultiInstance ? '🔄 Automatic (all instances)' : '📱 Manual'}
            {' · '}
            {instanceDisplayLabel(c)}
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
                              <p className="campaign-details__queue-meta" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
                                {c.isMultiInstance ? '🔄 Automatic (all instances)' : '📱 Manual'}
                                {' · '}
                                {instanceDisplayLabel(c)}
                              </p>
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
                              <ViewDetailsButton campaignId={c.id} onOpen={handleOpenDetails} disabled={actionBusy} />
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
                    <th>Instance</th>
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
                        <div className="campaign-details__history-name">{campaignDisplayLabel(c)}</div>
                      </td>
                      <td>
                        <StatusBadge status={c.status} />
                        {c.status === 'queued' && c.scheduledAt ? (
                          <div className="campaign-details__hint" style={{ marginTop: '0.35rem' }}>
                            Scheduled for: {formatScheduledUk(c.scheduledAt)}
                          </div>
                        ) : null}
                      </td>
                      <td>{instanceDisplayLabel(c)}</td>
                      <td>{c.totalContacts}</td>
                      <td>{c.sentCount}</td>
                      <td>{campaignFailedCount(c)}</td>
                      <td>{campaignSkippedCount(c)}</td>
                      <td>{formatDt(c.createdAt)}</td>
                      <td>{formatDt(c.completedAt)}</td>
                      <td className="campaign-details__history-actions">
                        <div className="campaign-details__history-actions-inner">
                          <ViewDetailsButton campaignId={c.id} onOpen={handleOpenDetails} disabled={actionBusy} />
                          <ViewUsersButton campaignId={c.id} onView={handleViewUsers} />
                          <button
                            type="button"
                            className="btn-delete btn-icon"
                            disabled={c.status === 'running' || actionBusy}
                            title={
                              c.status === 'running'
                                ? 'Stop the campaign before deleting.'
                                : 'Delete campaign'
                            }
                            aria-label={
                              c.status === 'running'
                                ? 'Stop the campaign before deleting.'
                                : 'Delete campaign'
                            }
                            onClick={() => setConfirmDeleteId(c.id)}
                          >
                            <IconTrash />
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

      {detailsModalOpen ? (
        <CampaignInfoModal
          campaign={detailsCampaign}
          loading={detailsLoading}
          error={detailsError}
          onClose={handleCloseDetails}
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
