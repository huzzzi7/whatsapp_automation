import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '../ui/Button';
import { startCampaign, getCampaignStatus, logCampaign } from '../../api';
import { applyTemplatesToUploadResult } from '../../utils/campaignTemplates';
import { buildCampaignLogPayload } from '../../utils/campaignLog';

const POLL_MS = 1500;

/**
 * @param {object} props
 * @param {object | null} props.uploadResult
 * @param {string} props.selectedInstanceId
 * @param {{ id: string; name?: string }[]} props.instances
 * @param {{ batchSize: number; delaySeconds: number; messageDelaySeconds?: number; templates: string[] }} props.campaignSettings
 * @param {{ phone?: string; university?: string; link?: string; group?: string; greenInstanceId?: string }} [props.testSettings]
 * @param {() => void} props.onBack
 * @param {(jobId: string) => void} props.onCampaignStart
 */
export default function CampaignReviewStep({
  uploadResult,
  selectedInstanceId,
  instances,
  campaignSettings,
  testSettings,
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

  const mergedUpload = useMemo(
    () => applyTemplatesToUploadResult(uploadResult, campaignSettings?.templates || []),
    [uploadResult, campaignSettings?.templates],
  );

  const instanceName = useMemo(() => {
    const row = instances?.find((i) => i.id === selectedInstanceId);
    return row?.name || selectedInstanceId || '—';
  }, [instances, selectedInstanceId]);

  const handleStart = useCallback(async () => {
    setStartError('');
    loggedRef.current = false;
    if (!selectedInstanceId) {
      setStartError('Select a WhatsApp instance.');
      return;
    }
    const users = mergedUpload?.users;
    if (!users || !Array.isArray(users) || users.length === 0) {
      setStartError('No recipients to send.');
      return;
    }

    setStarting(true);
    try {
      const data = await startCampaign(
        users,
        selectedInstanceId,
        campaignSettings.batchSize,
        campaignSettings.delaySeconds,
        Math.max(0, Number(campaignSettings.messageDelaySeconds) || 0),
      );
      if (!data?.ok || !data.jobId) {
        setStartError(data?.error || 'Campaign start failed.');
        return;
      }
      setJobId(String(data.jobId));
      setJobStatus('running');
      setProcessedUsers(0);
      setTotalUsers(users.length);
      setJobError('');
      onCampaignStart(String(data.jobId));
    } catch (e) {
      setStartError(e?.message || 'Request failed.');
    } finally {
      setStarting(false);
    }
  }, [mergedUpload, selectedInstanceId, campaignSettings, onCampaignStart]);

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
          if (mergedUpload && !loggedRef.current) {
            loggedRef.current = true;
            try {
              const payload = buildCampaignLogPayload(mergedUpload, mergedUpload.users, { scope: 'all' });
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
  }, [jobId, mergedUpload]);

  const firstTemplate = campaignSettings?.templates?.[0] ?? '';
  const uniCount = uploadResult?.universities?.length ?? 0;
  const totalRecipients = uploadResult?.totalUsers ?? uploadResult?.users?.length ?? 0;
  const recipientsWithGroup = useMemo(() => {
    const list = mergedUpload?.users;
    if (!Array.isArray(list)) return 0;
    return list.filter((u) => String(u?.group ?? '').trim()).length;
  }, [mergedUpload]);

  return (
    <div className="campaign-review-step">
      <h2 style={{ marginTop: 0 }}>Review &amp; send</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Confirm details below, then start the campaign. Message 1 will be sent to each recipient; replies trigger the
        rest of the sequence.
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
          <strong>Instance</strong>: {instanceName}
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Total users</strong>: {totalRecipients}
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Users with WhatsApp group link</strong>: {recipientsWithGroup} of {totalRecipients}
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Universities</strong>: {uniCount}
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Batch size</strong>: {campaignSettings?.batchSize ?? '—'}
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Delay between batches (seconds)</strong>: {campaignSettings?.delaySeconds ?? '—'}
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Delay between messages</strong>: {campaignSettings?.messageDelaySeconds ?? 0} seconds
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Message 1 preview</strong>: {firstTemplate ? String(firstTemplate) : '—'}
        </p>
        {testSettings && (testSettings.phone || testSettings.greenInstanceId) ? (
          <p style={{ margin: '0.5rem 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            <strong>Test</strong>:{' '}
            {testSettings.phone ? `phone ${testSettings.phone}` : '—'}
            {testSettings.university ? ` · university ${testSettings.university}` : ''}
            {testSettings.link ? ` · link set` : ''}
            {testSettings.group ? ` · group link set` : ''}
          </p>
        ) : null}
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
          disabled={starting || Boolean(jobId && jobStatus !== 'failed')}
          loading={starting}
        >
          {jobId ? (jobStatus === 'failed' ? 'Retry campaign' : 'Campaign started') : 'Start campaign'}
        </Button>
      </div>
    </div>
  );
}
