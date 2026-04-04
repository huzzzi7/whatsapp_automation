import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import ExcelUploadSection from '../components/automation/ExcelUploadSection';
import CampaignPreviewSection from '../components/automation/CampaignPreviewSection';
import CampaignMessageModal from '../components/automation/CampaignMessageModal';
import TestMessageModal from '../components/automation/TestMessageModal';
import {
  startCampaign,
  logCampaign,
  getCampaignTemplates,
  listGreenInstances,
  getCampaignStatus,
} from '../api';
import {
  DEFAULT_CAMPAIGN_TEMPLATE_STRINGS,
  applyTemplatesToUploadResult,
} from '../utils/campaignTemplates';

function buildCampaignLogPayload(uploadResult, usersSent, meta) {
  const byU = uploadResult.byUniversity ?? {};
  const unis = uploadResult.universities ?? [];
  const campaignId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `camp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  if (meta?.scope === 'all') {
    return {
      campaignId,
      totalUsers: usersSent.length,
      totalUniversities: unis.length,
      universityStats: unis.map((name) => ({
        name,
        usersSent: (byU[name] ?? []).length,
      })),
    };
  }

  const uniName = meta?.universityName ?? '(unknown)';
  return {
    campaignId,
    totalUsers: usersSent.length,
    totalUniversities: 1,
    universityStats: [{ name: uniName, usersSent: usersSent.length }],
  };
}

export default function AutomationPage() {
  const navigate = useNavigate();
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadedUserCount, setUploadedUserCount] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [statusText, setStatusText] = useState('');
  const [statusType, setStatusType] = useState('idle'); // idle | info | success | error

  const [messageTemplateStrings, setMessageTemplateStrings] = useState(() => [
    ...DEFAULT_CAMPAIGN_TEMPLATE_STRINGS,
  ]);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [campaignSettings, setCampaignSettings] = useState({
    batchSize: 20,
    delaySeconds: 30,
    messageDelaySeconds: 0,
  });
  const [activeJob, setActiveJob] = useState(null);
  const [universityJobs, setUniversityJobs] = useState({});
  const [nowTs, setNowTs] = useState(Date.now());

  const [instances, setInstances] = useState([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState(() => {
    try {
      return localStorage.getItem('whatsappGreenInstanceId') || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    listGreenInstances()
      .then((list) => {
        setInstances(list);
        setSelectedInstanceId((prev) => {
          if (prev && list.some((i) => i.id === prev)) return prev;
          return list[0]?.id || '';
        });
      })
      .catch(() => setInstances([]));
  }, []);

  useEffect(() => {
    try {
      if (selectedInstanceId) localStorage.setItem('whatsappGreenInstanceId', selectedInstanceId);
    } catch {
      /* ignore */
    }
  }, [selectedInstanceId]);

  useEffect(() => {
    let cancelled = false;
    getCampaignTemplates()
      .then((data) => {
        if (cancelled || !Array.isArray(data?.templates) || data.templates.length < 1) return;
        setMessageTemplateStrings(data.templates);
        setUploadResult((prev) => (prev ? applyTemplatesToUploadResult(prev, data.templates) : prev));
      })
      .catch(() => {
        /* keep DEFAULT_CAMPAIGN_TEMPLATE_STRINGS */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUploaded = useCallback(
    (data) => {
      const applied = applyTemplatesToUploadResult(data, messageTemplateStrings);
      setUploadResult(applied);
      const n = applied?.totalUsers ?? data?.totalUsers ?? data?.users?.length ?? 0;
      setUploadedUserCount(Number(n) || 0);
      setUploadError('');
      setStatusText('');
      setStatusType('idle');
    },
    [messageTemplateStrings],
  );

  const handleUploadError = useCallback((msg) => {
    setUploadError(typeof msg === 'string' ? msg : '');
  }, []);

  const closeMessageModal = useCallback(() => setIsMessageModalOpen(false), []);
  const closeTestModal = useCallback(() => setIsTestModalOpen(false), []);

  const handleTestResult = useCallback((msg, type = 'error') => {
    setStatusText(msg);
    setStatusType(type === 'success' ? 'success' : 'error');
  }, []);

  const handleSaveTemplates = useCallback((payload) => {
    const templates = payload?.templates ?? [];
    setMessageTemplateStrings(templates);
    setCampaignSettings({
      batchSize: Number(payload?.batchSize) || 20,
      delaySeconds: Math.max(0, Number(payload?.delaySeconds) || 0),
      messageDelaySeconds: Math.max(0, Number(payload?.messageDelaySeconds) || 0),
    });
    setUploadResult((prev) => (prev ? applyTemplatesToUploadResult(prev, templates) : prev));
    setIsMessageModalOpen(false);
  }, []);

  const toProgressView = useCallback((job) => {
    if (!job) return null;
    const totalUsers = Number(job.totalUsers) || 0;
    const processedUsers = Number(job.processedUsers) || 0;
    const batchSize = Math.max(1, Number(job.batchSize) || 1);
    const delaySeconds = Math.max(0, Number(job.delaySeconds) || 0);
    const batchCount = Math.ceil(totalUsers / batchSize);
    const totalTime = Math.max(0, (batchCount - 1) * delaySeconds);
    const elapsedSeconds = Math.max(0, Math.floor((nowTs - Number(job.startedAt || Date.now())) / 1000));
    return {
      ...job,
      percentage: totalUsers > 0 ? (processedUsers / totalUsers) * 100 : 0,
      remainingSeconds: Math.max(0, totalTime - elapsedSeconds),
    };
  }, [nowTs]);

  const sendUsers = useCallback(async (users, meta, currentUpload) => {
    if (!users?.length) return;
    const snapshot = currentUpload;
    setStatusText('Starting campaign...');
    setStatusType('info');
    if (!selectedInstanceId) {
      setStatusText('Select a WhatsApp instance first.');
      setStatusType('error');
      return;
    }
    try {
      const data = await startCampaign(
        users,
        selectedInstanceId,
        campaignSettings.batchSize,
        campaignSettings.delaySeconds,
        Math.max(0, Number(campaignSettings.messageDelaySeconds) || 0),
      );
      if (data?.ok) {
        const baseJob = {
          jobId: data.jobId,
          status: 'running',
          totalUsers: users.length,
          processedUsers: 0,
          batchSize: campaignSettings.batchSize,
          delaySeconds: campaignSettings.delaySeconds,
          messageDelaySeconds: Math.max(0, Number(campaignSettings.messageDelaySeconds) || 0),
          startedAt: Date.now(),
          error: '',
          snapshot,
          meta,
          logged: false,
        };
        if (meta?.scope === 'all') {
          setActiveJob(baseJob);
        } else if (meta?.scope === 'university') {
          setUniversityJobs((prev) => ({
            ...prev,
            [meta.universityName]: baseJob,
          }));
        }
        setStatusText('Campaign started.');
        setStatusType('success');
        navigate('/campaign-details');
      } else {
        setStatusText(data?.error || 'Campaign start failed.');
        setStatusType('error');
      }
    } catch (e) {
      setStatusText(e.message || 'Request failed.');
      setStatusType('error');
    }
  }, [selectedInstanceId, campaignSettings, navigate]);

  useEffect(() => {
    const hasActive = activeJob?.status === 'running'
      || Object.values(universityJobs).some((j) => j?.status === 'running');
    if (!hasActive) return undefined;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeJob, universityJobs]);

  useEffect(() => {
    const running = [];
    if (activeJob?.status === 'running') running.push({ scope: 'all', name: null, job: activeJob });
    Object.entries(universityJobs).forEach(([name, job]) => {
      if (job?.status === 'running') running.push({ scope: 'university', name, job });
    });
    if (!running.length) return undefined;

    const poll = async () => {
      await Promise.all(running.map(async ({ scope, name, job }) => {
        try {
          const status = await getCampaignStatus(job.jobId);
          const nextJob = {
            ...job,
            ...status,
          };
          if (scope === 'all') {
            setActiveJob(nextJob);
          } else {
            setUniversityJobs((prev) => ({ ...prev, [name]: nextJob }));
          }
          if (status.status === 'failed') {
            setStatusText(status.error || 'Campaign failed.');
            setStatusType('error');
          }
          if (status.status === 'completed' && !job.logged && job.snapshot) {
            try {
              const payload = buildCampaignLogPayload(job.snapshot, job.meta.scope === 'all'
                ? job.snapshot.users
                : (job.snapshot.byUniversity?.[job.meta.universityName] || []), job.meta);
              await logCampaign(payload);
              if (scope === 'all') {
                setActiveJob((prev) => (prev ? { ...prev, logged: true } : prev));
              } else {
                setUniversityJobs((prev) => ({
                  ...prev,
                  [name]: prev[name] ? { ...prev[name], logged: true } : prev[name],
                }));
              }
            } catch (logErr) {
              console.error('[Campaign log]', logErr);
            }
          }
        } catch (err) {
          setStatusText(err.message || 'Progress poll failed.');
          setStatusType('error');
        }
      }));
    };

    poll();
    const intervalId = setInterval(poll, 1500);
    return () => clearInterval(intervalId);
  }, [activeJob, universityJobs]);

  const handleSendAll = useCallback(() => {
    if (!uploadResult?.users) return;
    sendUsers(uploadResult.users, { scope: 'all' }, uploadResult);
  }, [uploadResult, sendUsers]);

  const handleSendUniversity = useCallback(
    (users, universityName) => {
      if (!uploadResult) return;
      sendUsers(users, { scope: 'university', universityName }, uploadResult);
    },
    [uploadResult, sendUsers],
  );

  const anyUniversityRunning = Object.values(universityJobs).some((j) => j?.status === 'running');
  const sendAllDisabled = Boolean(activeJob && activeJob.status === 'running') || anyUniversityRunning;
  const campaignBusy = sendAllDisabled;
  const sendDisabledByUniversity = useCallback((uniName) => {
    if (activeJob?.status === 'running') return true;
    const current = universityJobs[uniName];
    return current?.status === 'running';
  }, [activeJob, universityJobs]);

  const globalProgress = activeJob ? toProgressView(activeJob) : null;
  const universityProgressViews = Object.fromEntries(
    Object.entries(universityJobs).map(([k, v]) => [k, toProgressView(v)]),
  );

  return (
    <div className="automation-page">
      <h1>Send messages</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
         Configure instances under <strong>Settings</strong>.
        {uploadedUserCount > 0 ? (
          <>
            {' '}
            <span style={{ color: 'var(--text-primary)' }}>
              Current file: <strong>{uploadedUserCount}</strong> users.
            </span>
          </>
        ) : null}
      </p>

      <Card className="excel-upload-card">
        <ExcelUploadSection
          onUploaded={handleUploaded}
          onError={handleUploadError}
          disabled={campaignBusy}
          onAdjustCampaignMessages={() => setIsMessageModalOpen(true)}
          instances={instances}
          selectedInstanceId={selectedInstanceId}
          onSelectInstance={setSelectedInstanceId}
        />
        {uploadError ? <div className="alert-error" style={{ marginTop: '1rem' }}>{uploadError}</div> : null}
      </Card>

      {uploadResult ? (
        <Card className="campaign-preview-card">
          <CampaignPreviewSection
            uploadResult={uploadResult}
            onSendAll={handleSendAll}
            onSendUniversity={handleSendUniversity}
            onTestClick={() => setIsTestModalOpen(true)}
            campaignBusy={campaignBusy}
            statusText={statusText}
            statusType={statusType}
            instanceReady={Boolean(selectedInstanceId)}
            sendAllDisabled={sendAllDisabled}
            globalProgress={globalProgress}
            universityJobs={universityProgressViews}
            sendDisabledByUniversity={sendDisabledByUniversity}
          />
        </Card>
      ) : null}

      <CampaignMessageModal
        open={isMessageModalOpen}
        onClose={closeMessageModal}
        messageTemplateStrings={messageTemplateStrings}
        campaignSettings={campaignSettings}
        onSave={handleSaveTemplates}
      />

      <TestMessageModal
        open={isTestModalOpen}
        onClose={closeTestModal}
        instances={instances}
        defaultInstanceId={selectedInstanceId}
        messageTemplateStrings={messageTemplateStrings}
        onResult={handleTestResult}
      />
    </div>
  );
}
