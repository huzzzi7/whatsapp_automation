import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { getWarmupStatus, startWarmup, stopWarmup, listGreenInstances } from '../api';

function pct(sent, target) {
  const s = Number(sent) || 0;
  const t = Number(target) || 0;
  if (t <= 0) return 0;
  return Math.max(0, Math.min(100, Number(((s / t) * 100).toFixed(2))));
}

function StatusBadge({ status }) {
  const s = String(status || '').toLowerCase();
  const map = {
    running: 'campaign-details__badge campaign-details__badge--running',
    completed: 'campaign-details__badge campaign-details__badge--completed',
    stopped: 'campaign-details__badge campaign-details__badge--muted',
    failed: 'campaign-details__badge campaign-details__badge--failed',
    pending: 'campaign-details__badge campaign-details__badge--queued',
  };
  return <span className={map[s] || 'campaign-details__badge campaign-details__badge--muted'}>{status || '—'}</span>;
}

function ProgressBar({ percent }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="campaign-details__progress-bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div className="campaign-details__progress-fill" style={{ width: `${p}%` }} />
    </div>
  );
}

function formatInstLabel(inst) {
  if (!inst) return '—';
  const name = inst.name ? String(inst.name) : 'Instance';
  const phone = inst.phoneNumber ? String(inst.phoneNumber) : '';
  return phone ? `${name} (${phone})` : name;
}

export default function WarmupPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [instances, setInstances] = useState([]);
  const pollRef = useRef(null);

  useEffect(() => {
    listGreenInstances()
      .then((list) => setInstances(Array.isArray(list) ? list : []))
      .catch(() => setInstances([]));
  }, []);

  const instanceMap = useMemo(() => {
    const m = new Map();
    (instances || []).forEach((i) => m.set(i.id, i));
    return m;
  }, [instances]);

  const loadStatus = useCallback(async (sessionId) => {
    const data = await getWarmupStatus(sessionId);
    setStatus(data);
  }, []);

  useEffect(() => {
    loadStatus().catch(() => {});
  }, [loadStatus]);

  useEffect(() => {
    const s = status?.session?.status;
    const shouldPoll = s === 'running';
    if (!shouldPoll) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return undefined;
    }
    if (pollRef.current) return undefined;
    pollRef.current = setInterval(() => {
      loadStatus(status?.session?.id).catch(() => {});
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [status?.session?.status, status?.session?.id, loadStatus]);

  const overall = useMemo(() => {
    const sent = status?.stats?.messagesSent ?? 0;
    const target = status?.stats?.messagesTarget ?? 0;
    return { sent, target, percent: pct(sent, target) };
  }, [status]);

  const pairs = Array.isArray(status?.pairs) ? status.pairs : [];
  const session = status?.session || null;
  const isRunning = String(session?.status || '').toLowerCase() === 'running';

  const handleStart = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await startWarmup();
      await loadStatus(res?.sessionId || res?.session?.id);
    } catch (e) {
      setError(e?.message || 'Warm-up start failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    const sid = session?.id;
    if (!sid) return;
    setBusy(true);
    setError('');
    try {
      await stopWarmup(sid);
      await loadStatus(sid);
    } catch (e) {
      setError(e?.message || 'Warm-up stop failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="campaign-details-page">
      <h1 style={{ marginBottom: '0.5rem' }}>Warm-up System</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        Build trust between instances before launching campaigns.
      </p>

      {error ? <div className="alert-error">{error}</div> : null}

      <Card style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Control panel</h2>
            <p style={{ marginTop: '0.35rem', color: 'var(--text-muted)', fontSize: '14px' }}>
              Starts instance-to-instance scripted conversations across all pairs.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <StatusBadge status={session?.status || '—'} />
          </div>
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 280, color: 'var(--text-muted)', fontSize: '14px' }}>
            Each conversation will exchange <strong>25–40</strong> messages over <strong>60–90 minutes</strong>.
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Button
              type="button"
              className="ui-button--inline"
              onClick={handleStart}
              disabled={busy || isRunning}
            >
              Start warm-up
            </Button>
            {isRunning ? (
              <Button
                type="button"
                className="ui-button--inline ui-button--secondary"
                onClick={handleStop}
                disabled={busy}
              >
                Stop
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Live dashboard</h2>
            <p style={{ marginTop: '0.35rem', color: 'var(--text-muted)', fontSize: '14px' }}>
              Overall progress and per-pair status. Auto-polls every 5s while running.
            </p>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
            {session?.id ? (
              <>
                Session <code className="campaign-details__table-id">{session.id}</code>
              </>
            ) : (
              'No active session'
            )}
          </div>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <p className="campaign-details__stats" style={{ marginBottom: '0.5rem' }}>
            Sent <strong>{overall.sent}</strong> · Target <strong>{overall.target}</strong> · Progress{' '}
            <strong>{overall.percent}%</strong>
          </p>
          <ProgressBar percent={overall.percent} />
        </div>

        <div className="campaign-details__table-wrap" style={{ marginTop: '1rem' }}>
          <table className="campaign-details__table">
            <thead>
              <tr>
                <th>Sender (A)</th>
                <th>Receiver (B)</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Messages</th>
              </tr>
            </thead>
            <tbody>
              {pairs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-muted)', padding: '0.75rem 0.4rem' }}>
                    No pairs yet.
                  </td>
                </tr>
              ) : (
                pairs.map((p) => {
                  const sender = instanceMap.get(p.senderInstanceDbId);
                  const receiver = instanceMap.get(p.receiverInstanceDbId);
                  const sent = Number(p.messagesSent) || 0;
                  const target = Number(p.messagesTarget) || 0;
                  const percent = pct(sent, target);
                  return (
                    <tr key={p.id}>
                      <td>{formatInstLabel(sender)}</td>
                      <td>{formatInstLabel(receiver)}</td>
                      <td><StatusBadge status={p.status} /></td>
                      <td style={{ minWidth: 180 }}>
                        <ProgressBar percent={percent} />
                      </td>
                      <td>
                        {sent} / {target}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

