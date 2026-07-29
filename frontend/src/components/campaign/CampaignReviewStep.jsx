import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '../ui/Button';
import {
  startCampaign,
  getCampaignStatus,
  logCampaign,
  listGreenInstances,
  getCampaignPreview,
  listMetaTemplates,
} from '../../api';
import AuthStatusBadge from '../ui/AuthStatusBadge';
import { applyTemplatesToUploadResult } from '../../utils/campaignTemplates';
import { buildCampaignLogPayload } from '../../utils/campaignLog';
import { countRemainingOperationalDays } from '../../utils/remainingOperationalDays';

const POLL_MS = 1500;

/**
 * @param {object} props
 * @param {'green'|'meta'} [props.provider]
 * @param {object | null} props.uploadResult
 * @param {string} props.selectedInstanceId
 * @param {{ id: string; name?: string }[]} props.instances
 * @param {string} [props.campaignName]
 * @param {{ templates: string[] }} props.campaignSettings
 * @param {{ metaTemplateId: string, campaignStartDate: string, campaignEndDate: string, operationalDays: string }} [props.metaSettings]
 * @param {{ phone?: string; university?: string; link?: string; group?: string; greenInstanceId?: string }} [props.testSettings]
 * @param {() => void} props.onBack
 * @param {(jobId: string) => void} props.onCampaignStart
 */
export default function CampaignReviewStep({
  provider = 'green',
  uploadResult,
  selectedInstanceId,
  instances,
  campaignName = '',
  campaignSettings,
  metaSettings,
  testSettings,
  onBack,
  onCampaignStart,
}) {
  const isMeta = provider === 'meta';
  const [startError, setStartError] = useState('');
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState('');
  const [jobStatus, setJobStatus] = useState('');
  const [processedUsers, setProcessedUsers] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [jobError, setJobError] = useState('');
  const loggedRef = useRef(false);

  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [metaTemplate, setMetaTemplate] = useState(null);

  useEffect(() => {
    if (!isMeta || !metaSettings?.metaTemplateId) return;
    listMetaTemplates()
      .then((list) => {
        const found = list.find((t) => String(t.id) === String(metaSettings.metaTemplateId));
        setMetaTemplate(found || null);
      })
      .catch(() => setMetaTemplate(null));
  }, [isMeta, metaSettings?.metaTemplateId]);

  const mergedUpload = useMemo(() => {
    if (isMeta) return uploadResult;
    return applyTemplatesToUploadResult(uploadResult, campaignSettings?.templates || []);
  }, [isMeta, uploadResult, campaignSettings?.templates]);

  const [instanceCount, setInstanceCount] = useState(instances?.length || 0);

  useEffect(() => {
    if (instanceCount > 0) return;
    listGreenInstances()
      .then((list) => setInstanceCount(Array.isArray(list) ? list.length : 0))
      .catch(() => setInstanceCount(0));
  }, [instanceCount]);

  const instanceMode = campaignSettings?.instanceMode === 'manual' ? 'manual' : 'auto';
  const manualInstanceId = campaignSettings?.selectedInstanceId || selectedInstanceId || '';
  const operationalDays = String(campaignSettings?.operationalDays || '1,2,3,4,5');
  const operationalStart = String(campaignSettings?.operationalStart || '09:00');
  const operationalEnd = String(campaignSettings?.operationalEnd || '21:00');
  const campaignStartDate = String(campaignSettings?.campaignStartDate || '');
  const campaignEndDate = String(campaignSettings?.campaignEndDate || '');

  useEffect(() => {
    if (isMeta) return undefined;
    let cancelled = false;
    async function fetchPreview() {
      setPreviewLoading(true);
      setPreviewError('');
      try {
        const totalContacts = uploadResult?.totalUsers ?? uploadResult?.users?.length ?? 0;
        const isManual = campaignSettings?.instanceMode === 'manual' && manualInstanceId;
        const result = await getCampaignPreview({
          totalContacts,
          instanceMode: isManual ? 'manual' : 'auto',
          greenInstanceId: isManual ? manualInstanceId : undefined,
          operationalStart: campaignSettings?.operationalStart,
          operationalEnd: campaignSettings?.operationalEnd,
          operationalDays: campaignSettings?.operationalDays,
          campaignStartDate: campaignSettings?.campaignStartDate,
          campaignEndDate: campaignSettings?.campaignEndDate,
        });
        if (!cancelled) setPreview(result);
      } catch (e) {
        if (!cancelled) {
          setPreviewError(e.message || 'Preview unavailable');
          setPreview(null);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }
    fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [
    isMeta,
    uploadResult,
    manualInstanceId,
    campaignSettings?.instanceMode,
    campaignSettings?.operationalStart,
    campaignSettings?.operationalEnd,
    campaignSettings?.operationalDays,
    campaignSettings?.campaignStartDate,
    campaignSettings?.campaignEndDate,
  ]);

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

  function remainingOperationalDaysCount(mask, startIso, endIso) {
    return countRemainingOperationalDays(startIso, endIso, mask, Date.now(), 'Europe/London', operationalEnd);
  }

  const estimatedDailyPerInstance = useMemo(() => {
    const total = Number(uploadResult?.totalUsers ?? uploadResult?.users?.length ?? 0) || 0;
    const remainingDays = remainingOperationalDaysCount(operationalDays, campaignStartDate, campaignEndDate);
    const totalDaily = Math.ceil(total / remainingDays);
    if (instanceMode === 'manual') return Math.max(1, totalDaily);
    const n = instanceCount > 0 ? instanceCount : 1;
    return Math.max(1, Math.ceil(totalDaily / n));
  }, [uploadResult, operationalDays, campaignStartDate, campaignEndDate, instanceMode, instanceCount, operationalEnd]);

  const isNameValid = useMemo(
    () => Boolean(campaignName != null && String(campaignName).trim().length > 0),
    [campaignName],
  );

  const instanceName = useMemo(() => {
    const id = instanceMode === 'manual' ? manualInstanceId : selectedInstanceId;
    const row = instances?.find((i) => i.id === id);
    return row?.name || id || '—';
  }, [instances, selectedInstanceId, instanceMode, manualInstanceId]);

  const submitStart = useCallback(async () => {
    setStartError('');
    loggedRef.current = false;
    if (!isMeta && instanceMode === 'manual' && !manualInstanceId) {
      setStartError('Select a WhatsApp instance.');
      return false;
    }
    if (isMeta && !String(metaSettings?.metaTemplateId || '').trim()) {
      setStartError('Choose a Meta template.');
      return false;
    }
    const users = mergedUpload?.users;
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
      const trimmedName = cleanName;
      const data = isMeta
        ? await startCampaign(users, {
            provider: 'meta',
            metaTemplateId: metaSettings?.metaTemplateId,
            name: trimmedName,
            campaignStartDate: metaSettings?.campaignStartDate,
            campaignEndDate: metaSettings?.campaignEndDate,
          })
        : await startCampaign(users, {
            greenInstanceId: instanceMode === 'manual' ? manualInstanceId : null,
            name: trimmedName,
            operationalStart,
            operationalEnd,
            operationalDays,
            campaignStartDate,
            campaignEndDate,
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
    isMeta,
    mergedUpload,
    selectedInstanceId,
    campaignSettings,
    metaSettings,
    campaignName,
    onCampaignStart,
    instanceMode,
    manualInstanceId,
    operationalStart,
    operationalEnd,
    operationalDays,
    campaignStartDate,
    campaignEndDate,
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
      {/* Instance Preview Panel */}
      {isMeta ? (
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
      ) : (
      <div
        style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          border: '1px solid var(--border)',
          borderRadius: 10,
          background: 'var(--bg)',
        }}
      >
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600 }}>
          Instances for this Campaign
        </h3>

        {previewLoading && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Calculating instance plan…</p>
        )}

        {!previewLoading && previewError && (
          <div
            style={{
              padding: '0.6rem 0.9rem',
              background: 'var(--error-bg)',
              border: '1px solid var(--error)',
              borderRadius: 6,
              fontSize: '0.85rem',
              color: 'var(--error)',
              marginBottom: '0.75rem',
            }}
          >
            ⚠ Preview unavailable: {previewError}
          </div>
        )}

        {!previewLoading && preview && preview.ok && (
          <>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {preview.instances.map((inst) => (
                <div
                  key={inst.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '0.75rem 1rem',
                    minWidth: 180,
                    background: 'var(--surface)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 2 }}>
                    {inst.name || '—'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                    {inst.phoneNumber || '—'}
                  </div>
                  <AuthStatusBadge authStatus={inst.authStatus} />
                  {inst.dailyLimitPerInstance != null && (
                    <div style={{ fontSize: '0.8rem', marginTop: 6, color: 'var(--text-muted)' }}>
                      ~{inst.dailyLimitPerInstance} msgs / day
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div
              style={{
                display: 'flex',
                gap: '1.5rem',
                flexWrap: 'wrap',
                padding: '0.6rem 0.9rem',
                background: 'var(--bg)',
                borderRadius: 6,
                fontSize: '0.875rem',
              }}
            >
              <span>
                <strong>Instances:</strong> {preview.instanceCount}
              </span>
              {preview.dailyLimitPerInstance != null && (
                <span>
                  <strong>Per instance / day:</strong> {preview.dailyLimitPerInstance}
                </span>
              )}
              {preview.totalDailyMessages != null && (
                <span>
                  <strong>Total / day:</strong> {preview.totalDailyMessages}
                </span>
              )}
              {preview.dailyLimitPerInstance == null && (
                <span style={{ color: 'var(--text-muted)' }}>
                  Daily pace set by operational window &amp; server rate limits
                </span>
              )}
            </div>
          </>
        )}
      </div>
      )}

      <h2 style={{ marginTop: 0 }}>Review &amp; send</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
        {isMeta
          ? 'Confirm details below, then start the campaign.'
          : 'Confirm details below, then start the campaign. Message 1 will be sent to each recipient; replies trigger the rest of the sequence.'}
      </p>

      {isMeta ? (
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
      ) : (
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
          <strong>Instance Mode</strong>:{' '}
          {instanceMode === 'manual'
            ? `Manual: ${instanceName}`
            : `Auto (${instanceCount ? `${instanceCount} instances` : 'all instances'})`}
        </p>
        {instanceMode === 'manual' ? (
          <p style={{ margin: '0 0 0.5rem' }}>
            <strong>Instance</strong>: {instanceName}
          </p>
        ) : null}
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
          <strong>Start date</strong>: {campaignStartDate || '—'}
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>End date</strong>: {campaignEndDate || '—'}
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Operational days</strong>: {fmtOperationalDaysHuman(operationalDays)}
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Daily window</strong>: {operationalStart} – {operationalEnd} (London)
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Est. daily messages per instance</strong>:{' '}
          ~{estimatedDailyPerInstance} messages/instance/day
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
      )}

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
