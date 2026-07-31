import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '../ui/Button';
import {
  startCampaign,
  getCampaignStatus,
  logCampaign,
  listMetaTemplates,
} from '../../api';
import { buildCampaignLogPayload } from '../../utils/campaignLog';

const POLL_MS = 1500;

/**
 * @param {object} props
 * @param {object | null} props.uploadResult
 * @param {string} [props.campaignName]
 * @param {{ metaTemplateId: string, campaignStartDate: string, campaignEndDate: string, operationalDays: string }} [props.metaSettings]
 * @param {() => void} props.onBack
 * @param {(jobId: string) => void} props.onCampaignStart
 */
export default function CampaignReviewStep({
  uploadResult,
  campaignName = '',
  metaSettings,
  onBack,
  onCampaignStart,
}) {
  const [startError, setStartError] = useState('');
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState('');
  const [jobStatus, setJobStatus] = useState('');
  const [processedUsers, setProcessedUsers] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [jobError, setJobError] = useState('');
  const loggedRef = useRef(false);

  const [metaTemplate, setMetaTemplate] = useState(null);

  useEffect(() => {
    if (!metaSettings?.metaTemplateId) return;
    listMetaTemplates()
      .then((list) => {
        const found = list.find((t) => String(t.id) === String(metaSettings.metaTemplateId));
        setMetaTemplate(found || null);
      })
      .catch(() => setMetaTemplate(null));
  }, [metaSettings?.metaTemplateId]);

  function parseDaysSet(str) {
    const set = new Set();
    for (const part of String(str || '').split(',').map((s) => s.trim()).filter(Boolean)) {
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

  const isNameValid = useMemo(
    () => Boolean(campaignName != null && String(campaignName).trim().length > 0),
    [campaignName],
  );

  const submitStart = useCallback(async () => {
    setStartError('');
    loggedRef.current = false;
    if (!String(metaSettings?.metaTemplateId || '').trim()) {
      setStartError('Choose a Meta template.');
      return false;
    }
    const users = uploadResult?.users;
    if (!users || !Array.isArray(users) || users.length === 0) {
      setStartError('No recipients to send.');
      return false;
    }

    const cleanName = campaignName != null ? String(campaignName).trim() : '';
    if (!cleanName) {
      setStartError('Campaign name is required');
      return false;
    }

    setStarting(true);
    try {
      const data = await startCampaign(users, {
        provider: 'meta',
        metaTemplateId: metaSettings?.metaTemplateId,
        name: cleanName,
        campaignStartDate: metaSettings?.campaignStartDate,
        campaignEndDate: metaSettings?.campaignEndDate,
      });
      if (!data?.ok || !data.jobId) {
        setStartError(data?.error || 'Campaign start failed.');
        return false;
      }
      setJobId(String(data.jobId));
      setJobStatus('running');
      setProcessedUsers(0);
      setTotalUsers(users.length);
      setJobError('');
      onCampaignStart(String(data.jobId));
      return true;
    } catch (e) {
      setStartError(e?.message || 'Request failed.');
      return false;
    } finally {
      setStarting(false);
    }
  }, [
    uploadResult,
    metaSettings,
    campaignName,
    onCampaignStart,
  ]);

  const handleStart = useCallback(() => {
    void submitStart();
  }, [submitStart]);

  useEffect(() => {
    if (!jobId) return undefined;

    let cancelled = false;
    let intervalId;

    const tick = async () => {
      try {
        const status = await getCampaignStatus(jobId);
        if (cancelled) return;
        const st = String(status?.status || '');
        setJobStatus(st);
        setProcessedUsers(Number(status?.processedUsers) || 0);
        setTotalUsers(Number(status?.totalUsers) || 0);
        if (st === 'failed') {
          setJobError(status?.error || 'Campaign failed.');
          if (intervalId) clearInterval(intervalId);
          return;
        }
        if (st === 'completed') {
          if (uploadResult && !loggedRef.current) {
            loggedRef.current = true;
            try {
              const payload = buildCampaignLogPayload(uploadResult, uploadResult.users, { scope: 'all' });
              await logCampaign(payload);
            } catch (logErr) {
              console.error('[Campaign log]', logErr);
            }
          }
          if (intervalId) clearInterval(intervalId);
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setJobError(err?.message || 'Progress poll failed.');
          setJobStatus('failed');
          if (intervalId) clearInterval(intervalId);
        }
      }
    };

    tick();
    intervalId = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [jobId, uploadResult]);

  const totalRecipients = uploadResult?.totalUsers ?? uploadResult?.users?.length ?? 0;

  return (
    <div className="campaign-review-step">
      {/* Meta Cloud API Panel */}
      <div
        style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          border: '1px solid var(--border)',
          borderRadius: 10,
          background: 'var(--bg)',
        }}
      >
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600 }}>Meta Cloud API</h3>
        <p style={{ margin: '0 0 0.35rem' }}>
          <strong>Template</strong>: {metaTemplate?.name || `#${metaSettings?.metaTemplateId || '—'}`}
          {metaTemplate?.languageCode ? ` (${metaTemplate.languageCode})` : ''}
        </p>
        {metaTemplate ? (
          <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {metaTemplate.variables.length > 0
              ? `Variables: ${metaTemplate.variables.join(', ')}`
              : 'No variables required.'}
          </p>
        ) : null}
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Up to 1800 messages/day, spread evenly across 00:00–23:59.
        </p>
      </div>

      <h2 style={{ marginTop: 0 }}>Review &amp; send</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Confirm details below, then start the campaign.
      </p>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '1rem',
          marginBottom: '1rem',
          background: 'var(--bg)',
        }}
      >
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Total users</strong>: {totalRecipients}
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Start date</strong>: {metaSettings?.campaignStartDate || '—'}
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>End date</strong>: {metaSettings?.campaignEndDate || '—'}
        </p>
        <p style={{ margin: 0 }}>
          <strong>Operational days</strong>: {fmtOperationalDaysHuman(metaSettings?.operationalDays)}
        </p>
      </div>

      {startError ? <div className="alert-error" style={{ marginBottom: '1rem' }}>{startError}</div> : null}
      {jobError ? <div className="alert-error" style={{ marginBottom: '1rem' }}>{jobError}</div> : null}

      {jobId ? (
        <div style={{ marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ marginBottom: '0.35rem' }}>
            Status: <strong>{jobStatus || '…'}</strong>
            {' · '}
            {processedUsers}/{totalUsers} users processed
          </div>
          <div style={{ height: 8, background: '#e5e7eb', borderRadius: 9999, overflow: 'hidden' }}>
            <div
              style={{
                width: `${totalUsers > 0 ? Math.min(100, (processedUsers / totalUsers) * 100) : 0}%`,
                height: '100%',
                background: jobStatus === 'failed' ? '#dc2626' : '#2563eb',
              }}
            />
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button type="button" className="ui-button--inline ui-button--secondary" onClick={onBack} disabled={starting}>
          Back
        </Button>
        <Button
          type="button"
          className="ui-button--inline"
          onClick={handleStart}
          disabled={!isNameValid || starting || Boolean(jobId && jobStatus !== 'failed')}
          loading={starting}
        >
          {jobId ? (jobStatus === 'failed' ? 'Retry campaign' : 'Campaign started') : 'Start campaign'}
        </Button>
      </div>
    </div>
  );
}
