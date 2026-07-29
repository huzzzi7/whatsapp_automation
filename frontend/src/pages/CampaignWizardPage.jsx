import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import CampaignStepper from '../components/campaign/CampaignStepper';
import ExcelUploadSection from '../components/automation/ExcelUploadSection';
import { getConfig, listGreenInstances } from '../api';
import CampaignSettingsForm from '../components/campaign/CampaignSettingsForm';
import MetaCampaignSettingsForm, {
  normalizeMetaCampaignSettings,
  validateMetaCampaignSettings,
} from '../components/campaign/MetaCampaignSettingsForm';
import CampaignTestForm from '../components/campaign/CampaignTestForm';
import CampaignReviewStep from '../components/campaign/CampaignReviewStep';
import ExcelPreviewTable from '../components/campaign/ExcelPreviewTable';
import { DEFAULT_CAMPAIGN_TEMPLATE_STRINGS } from '../utils/campaignTemplates';
import { countRemainingOperationalDays } from '../utils/remainingOperationalDays';

const TOTAL_STEPS = 4;

function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function todayPlusDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function CampaignWizardPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState({
    provider: 'green',
    selectedInstanceId: '',
    uploadResult: null,
    campaignSettings: {
      templates: [...DEFAULT_CAMPAIGN_TEMPLATE_STRINGS],
      campaignStartDate: todayIso(),
      operationalDays: '1,2,3,4,5',
      campaignEndDate: todayPlusDaysIso(7),
      operationalStart: '09:00',
      operationalEnd: '21:00',
      instanceMode: 'auto',
      selectedInstanceId: '',
    },
    metaSettings: normalizeMetaCampaignSettings({}),
    testState: {
      status: 'idle',
    },
    testSettings: {
      phone: '',
      university: '',
      link: '',
      group: '',
      greenInstanceId: '',
    },
    campaignJob: null,
  });
  const [instances, setInstances] = useState([]);
  const [rateConfig, setRateConfig] = useState({ rateLimitMessagesPerWindow: 3, rateLimitWindowMs: 60000 });
  const [campaignName, setCampaignName] = useState('');
  const [stepError, setStepError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  useEffect(() => {
    listGreenInstances()
      .then((list) => {
        setInstances(list);
        setWizardData((prev) => {
          const selected = prev.campaignSettings?.selectedInstanceId || prev.selectedInstanceId;
          if (selected && list.some((i) => i.id === selected)) return prev;
          return {
            ...prev,
            selectedInstanceId: prev.selectedInstanceId || '',
            campaignSettings: {
              ...prev.campaignSettings,
              selectedInstanceId: list[0]?.id || '',
            },
          };
        });
      })
      .catch(() => setInstances([]));

    getConfig().then(setRateConfig).catch((err) => {
      console.warn('[CampaignWizard] getConfig failed, using defaults:', err?.message);
    });
  }, []);

  useEffect(() => {
    if (currentStep !== 3) return;
    setWizardData((prev) => {
      if (prev.testSettings.greenInstanceId) return prev;
      return {
        ...prev,
        testSettings: {
          ...prev.testSettings,
          greenInstanceId: prev.selectedInstanceId || '',
        },
      };
    });
  }, [currentStep]);

  const isNameValid = Boolean(campaignName && campaignName.trim().length > 0);

  const canGoToStep = (step) => {
    if (step <= 1) return true;
    if (step === 2) return true;
    if (step === 3) return true;
    if (step === 4) return true;
    return false;
  };

  const goToStep = (step) => {
    const safeStep = Math.max(1, Math.min(TOTAL_STEPS, Number(step) || 1));
    if (!canGoToStep(safeStep)) return;
    setCurrentStep(safeStep);
  };

  const nextStep = () => {
    if (currentStep === 1) {
      const users = wizardData.uploadResult?.users;
      const hasUsers = Array.isArray(users) && users.length > 0;
      if (!hasUsers) {
        setStepError('Please upload a valid file');
        return;
      }
    }
    if (currentStep === 2 && wizardData.provider === 'meta') {
      const result = validateMetaCampaignSettings(wizardData.metaSettings);
      if (!result.ok) {
        setStepError(result.error);
        return;
      }
    }
    if (currentStep === 2 && wizardData.provider !== 'meta') {
      const cs = wizardData.campaignSettings;
      const templates = cs?.templates;
      const hasTemplates =
        Array.isArray(templates) && templates.length >= 1 && String(templates[0] ?? '').trim();
      const mode = cs?.instanceMode === 'manual' ? 'manual' : 'auto';
      const manualOk = mode === 'manual' ? Boolean(String(cs?.selectedInstanceId || '').trim()) : true;
      const startOk = /^\d{2}:\d{2}$/.test(String(cs?.operationalStart || ''));
      const endOk = /^\d{2}:\d{2}$/.test(String(cs?.operationalEnd || ''));
      const endGt = String(cs?.operationalEnd || '') > String(cs?.operationalStart || '');
      const daysOk = Boolean(String(cs?.operationalDays || '').trim());
      const startDateOk = /^\d{4}-\d{2}-\d{2}$/.test(String(cs?.campaignStartDate || ''));
      const endDateOk = /^\d{4}-\d{2}-\d{2}$/.test(String(cs?.campaignEndDate || ''));
      const dateRangeOk =
        startDateOk &&
        endDateOk &&
        String(cs?.campaignEndDate || '') >= String(cs?.campaignStartDate || '');
      if (!hasTemplates) {
        setStepError('Add at least one message (Message 1 cannot be empty).');
        return;
      }
      if (!daysOk) {
        setStepError('Select at least one operational day.');
        return;
      }
      if (!dateRangeOk) {
        setStepError('Campaign start and end dates must be valid, with end on or after start.');
        return;
      }
      if (!startOk || !endOk) {
        setStepError('Operational times must be in HH:MM format.');
        return;
      }
      if (!endGt) {
        setStepError('Operational end time must be after start time.');
        return;
      }
      if (!manualOk) {
        setStepError('Choose a WhatsApp instance (manual mode).');
        return;
      }

      // Validate selected time slot is sufficient for the campaign
      const contacts = wizardData.uploadResult?.totalUsers ?? wizardData.uploadResult?.users?.length ?? 0;
      const seqLen = Math.max(1, (cs.templates || []).length);
      const instCount = Math.max(1, instances.length || 1);
      const maxPerMin = rateConfig.rateLimitMessagesPerWindow / (rateConfig.rateLimitWindowMs / 60000);
      const totalMsgs = contacts * seqLen;
      const minMinutes = Math.ceil(totalMsgs / (maxPerMin * instCount));

      const [sH, sM] = String(cs.operationalStart || '09:00').split(':').map(Number);
      const [eH, eM] = String(cs.operationalEnd || '21:00').split(':').map(Number);
      const minutesPerDay = Math.max(0, (eH * 60 + (eM || 0)) - (sH * 60 + (sM || 0)));

      const selectedDays = countRemainingOperationalDays(
        cs.campaignStartDate,
        cs.campaignEndDate,
        cs.operationalDays,
        Date.now(),
        'Europe/London',
        cs.operationalEnd,
      );
      const totalSelectedMinutes = minutesPerDay * selectedDays;

      if (minMinutes > 0 && totalSelectedMinutes < minMinutes) {
        const displayRequired = minMinutes < 60 ? `${minMinutes} min` : `${(minMinutes / 60).toFixed(1)}h`;
        const displaySelected =
          totalSelectedMinutes < 60 ? `${totalSelectedMinutes} min` : `${(totalSelectedMinutes / 60).toFixed(1)}h`;
        setStepError(
          `Selected time slot (${displaySelected}) is less than minimum required (${displayRequired}). ` +
            `Extend your operational hours or add more days.`
        );
        return;
      }
    }
    if (currentStep === 3) {
      const users = wizardData.uploadResult?.users;
      const hasUsers = Array.isArray(users) && users.length > 0;
      if (!hasUsers) {
        setStepError('Please upload a valid file');
        return;
      }
    }
    const cleanName = campaignName.trim();
    if (!cleanName) {
      setStepError('Campaign name is required');
      return;
    }
    setStepError('');
    goToStep(currentStep + 1);
  };

  const prevStep = () => {
    goToStep(currentStep - 1);
  };

  const stepContent = useMemo(() => {
    if (currentStep === 1) return 'Step 1: Upload Excel';
    if (currentStep === 2) return 'Step 2: Campaign Settings';
    if (currentStep === 3) return 'Step 3: Test Campaign (Optional)';
    return 'Step 4: Start Campaign';
  }, [currentStep]);

  const handleUploaded = useCallback((result) => {
    setWizardData((prev) => ({
      ...prev,
      uploadResult: {
        users: result?.users ?? [],
        byUniversity: result?.byUniversity ?? {},
        universities: result?.universities ?? [],
        totalUsers: Number(result?.totalUsers ?? result?.users?.length ?? 0) || 0,
      },
      selectedInstanceId: prev.selectedInstanceId,
    }));
    const totalUsers = Number(result?.totalUsers ?? result?.users?.length ?? 0) || 0;
    setUploadError('');
    setStepError('');
    setUploadSuccess(`Upload successful. Total users: ${totalUsers}`);
  }, []);

  const handleUploadError = useCallback((message) => {
    const msg = typeof message === 'string' ? message : 'Upload failed.';
    setUploadError(msg);
    setUploadSuccess('');
  }, []);

  const setSelectedInstanceId = useCallback((id) => {
    setWizardData((prev) => ({
      ...prev,
      selectedInstanceId: id,
      uploadResult: null,
      campaignSettings: {
        ...prev.campaignSettings,
        selectedInstanceId: id,
      },
    }));
    setUploadSuccess('');
    setStepError('');
  }, []);

  const setProvider = useCallback((provider) => {
    setWizardData((prev) => ({
      ...prev,
      provider,
      uploadResult: null,
    }));
    setUploadSuccess('');
    setUploadError('');
    setStepError('');
  }, []);

  return (
    <div>
      <h1>Campaign Wizard</h1>
      <CampaignStepper currentStep={currentStep} />

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '1rem',
          marginBottom: '1rem',
          background: 'var(--surface)',
        }}
      >
        {currentStep === 1 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="campaign-name-field">
              <label className="ui-input-label" htmlFor="campaign-wizard-name" style={{ display: 'block', marginBottom: 6 }}>
                Campaign name <span className="campaign-name-field__required" aria-hidden>(required)</span>
              </label>
              <input
                id="campaign-wizard-name"
                type="text"
                className="campaign-name-field__input"
                placeholder="Enter campaign name"
                value={campaignName}
                onChange={(e) => {
                  setCampaignName(e.target.value);
                  setStepError('');
                }}
                maxLength={255}
                autoComplete="off"
                aria-required="true"
              />
              {!isNameValid ? (
                <p className="campaign-name-field__hint" role="status">
                  Campaign name is required
                </p>
              ) : null}
            </div>
            <div className="campaign-provider-field">
              <span className="ui-input-label" style={{ display: 'block', marginBottom: 6 }}>
                Send via
              </span>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="radio"
                    name="campaign-provider"
                    checked={wizardData.provider !== 'meta'}
                    onChange={() => setProvider('green')}
                  />
                  <span>Green API (legacy, message sequence)</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="radio"
                    name="campaign-provider"
                    checked={wizardData.provider === 'meta'}
                    onChange={() => setProvider('meta')}
                  />
                  <span>Meta Cloud API (template)</span>
                </label>
              </div>
            </div>
            <ExcelUploadSection
              onUploaded={handleUploaded}
              onError={handleUploadError}
              disabled={false}
              showCampaignSettingsButton={false}
              provider={wizardData.provider}
            />
            {uploadError ? <div className="alert-error">{uploadError}</div> : null}
            {uploadSuccess ? <div className="alert-success">{uploadSuccess}</div> : null}
            {wizardData.uploadResult?.users?.length > 0 ? (
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 600 }}>
                  Uploaded Users Preview
                </h3>
                <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Scroll to view more users
                </p>
                <ExcelPreviewTable users={wizardData.uploadResult.users} />
              </div>
            ) : null}
          </div>
        ) : currentStep === 2 ? (
          <>
            <h2 className="campaign-message-modal__title" style={{ marginTop: 0 }}>
              Campaign Settings
            </h2>
            {wizardData.provider === 'meta' ? (
              <MetaCampaignSettingsForm
                value={wizardData.metaSettings}
                onChange={(updated) => {
                  setStepError('');
                  setWizardData((prev) => ({
                    ...prev,
                    metaSettings: updated,
                  }));
                }}
                error={stepError || undefined}
              />
            ) : (
              <CampaignSettingsForm
                value={wizardData.campaignSettings}
                onChange={(updated) => {
                  setStepError('');
                  setWizardData((prev) => ({
                    ...prev,
                    campaignSettings: updated,
                  }));
                }}
                instances={instances}
                error={stepError || undefined}
                totalContacts={wizardData.uploadResult?.totalUsers ?? wizardData.uploadResult?.users?.length ?? 0}
                instanceCount={instances.length || 1}
                rateConfig={rateConfig}
              />
            )}
          </>
        ) : currentStep === 3 ? (
          <>
            <h2 className="test-message-modal__title" style={{ marginTop: 0 }}>
              Test campaign (optional)
            </h2>
            {wizardData.provider === 'meta' ? (
              <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '14px' }}>
                Use the "Send test template" tool on the Settings page to test this template before sending. Click
                Skip to continue to the full campaign.
              </p>
            ) : (
              <>
                <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '14px' }}>
                  Send a test message to one number, or skip to start the full campaign.
                </p>
                <CampaignTestForm
                  value={wizardData.testSettings}
                  onChange={(updated) => {
                    setStepError('');
                    setWizardData((prev) => ({
                      ...prev,
                      testSettings: updated,
                    }));
                  }}
                  instances={instances}
                  messageTemplateStrings={wizardData.campaignSettings.templates}
                  error={stepError || undefined}
                />
              </>
            )}
          </>
        ) : currentStep === 4 ? (
          <CampaignReviewStep
            provider={wizardData.provider}
            uploadResult={wizardData.uploadResult}
            selectedInstanceId={wizardData.campaignSettings?.selectedInstanceId || wizardData.selectedInstanceId}
            instances={instances}
            campaignName={campaignName}
            campaignSettings={wizardData.campaignSettings}
            metaSettings={wizardData.metaSettings}
            testSettings={wizardData.testSettings}
            onBack={() => goToStep(3)}
            onCampaignStart={(jobId) => {
              setWizardData((prev) => ({
                ...prev,
                campaignJob: { jobId, status: 'running' },
              }));
              navigate('/campaign-details');
            }}
          />
        ) : (
          <p style={{ margin: 0 }}>{stepContent}</p>
        )}
      </div>

      {stepError && currentStep !== 2 && currentStep !== 3 ? (
        <div className="alert-error" style={{ marginBottom: '1rem' }}>
          {stepError}
        </div>
      ) : null}

      {currentStep !== 4 ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {currentStep > 1 ? (
            <Button type="button" className="ui-button--inline ui-button--secondary" onClick={prevStep}>
              Back
            </Button>
          ) : null}

          {currentStep === 3 ? (
            <Button
              type="button"
              className="ui-button--inline ui-button--secondary"
              onClick={() => {
                const cleanName = campaignName.trim();
                if (!cleanName) {
                  setStepError('Campaign name is required');
                  return;
                }
                setStepError('');
                setWizardData((prev) => ({
                  ...prev,
                  testState: { ...prev.testState, status: 'skipped' },
                }));
                goToStep(4);
              }}
              disabled={!isNameValid}
            >
              Skip
            </Button>
          ) : null}

          {currentStep < TOTAL_STEPS ? (
            <Button
              type="button"
              className="ui-button--inline"
              onClick={nextStep}
              disabled={
                !isNameValid ||
                (currentStep === 1 &&
                  (!Array.isArray(wizardData.uploadResult?.users) || wizardData.uploadResult.users.length === 0))
              }
            >
              Next
            </Button>
          ) : null}
        </div>
      ) : null}

      <div style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '13px' }}>
        {wizardData.campaignJob?.jobId ? (
          <span>
            Last job: {wizardData.campaignJob.jobId} ({wizardData.campaignJob.status || '—'})
          </span>
        ) : (
          <span>
            Test status: {wizardData.testState.status}. Instance: {wizardData.selectedInstanceId || 'not selected'}.
          </span>
        )}
      </div>
    </div>
  );
}
