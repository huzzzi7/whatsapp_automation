import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import CampaignStepper from '../components/campaign/CampaignStepper';
import ExcelUploadSection from '../components/automation/ExcelUploadSection';
import { listGreenInstances } from '../api';
import CampaignSettingsForm from '../components/campaign/CampaignSettingsForm';
import CampaignTestForm from '../components/campaign/CampaignTestForm';
import CampaignReviewStep from '../components/campaign/CampaignReviewStep';
import ExcelPreviewTable from '../components/campaign/ExcelPreviewTable';
import { DEFAULT_CAMPAIGN_TEMPLATE_STRINGS } from '../utils/campaignTemplates';

const TOTAL_STEPS = 4;

export default function CampaignWizardPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState({
    selectedInstanceId: '',
    uploadResult: null,
    campaignSettings: {
      batchSize: 10,
      delaySeconds: 5,
      messageDelaySeconds: 0,
      templates: [...DEFAULT_CAMPAIGN_TEMPLATE_STRINGS],
    },
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
  const [stepError, setStepError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  useEffect(() => {
    listGreenInstances()
      .then((list) => {
        setInstances(list);
        setWizardData((prev) => {
          if (prev.selectedInstanceId && list.some((i) => i.id === prev.selectedInstanceId)) return prev;
          return {
            ...prev,
            selectedInstanceId: list[0]?.id || '',
          };
        });
      })
      .catch(() => setInstances([]));
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

  const canGoToStep = (step) => {
    if (step <= 1) return true;
    if (step === 2) return true; // Step 1 placeholder validation (allow for now)
    if (step === 3) return true; // Step 2 placeholder validation (allow for now)
    if (step === 4) return true; // Step 2 required logically; placeholder allows now
    return false;
  };

  const goToStep = (step) => {
    const safeStep = Math.max(1, Math.min(TOTAL_STEPS, Number(step) || 1));
    if (!canGoToStep(safeStep)) return;
    setCurrentStep(safeStep);
  };

  const nextStep = () => {
    if (currentStep === 1) {
      const hasInstance = Boolean(wizardData.selectedInstanceId);
      const users = wizardData.uploadResult?.users;
      const hasUsers = Array.isArray(users) && users.length > 0;
      if (!hasInstance || !hasUsers) {
        setStepError('Please select instance and upload a valid file');
        return;
      }
    }
    if (currentStep === 2) {
      const cs = wizardData.campaignSettings;
      const templates = cs?.templates;
      const hasTemplates =
        Array.isArray(templates) && templates.length >= 1 && String(templates[0] ?? '').trim();
      const batchNum = Number(cs.batchSize);
      const batchOk = Number.isFinite(batchNum) && Math.floor(batchNum) >= 1;
      const md = Number(cs.messageDelaySeconds);
      const messageDelayOk = Number.isFinite(md) && md >= 0;
      if (!hasTemplates || !batchOk || !messageDelayOk) {
        setStepError('Please configure valid campaign settings');
        return;
      }
    }
    if (currentStep === 3) {
      const hasInstance = Boolean(wizardData.selectedInstanceId);
      const users = wizardData.uploadResult?.users;
      const hasUsers = Array.isArray(users) && users.length > 0;
      if (!hasInstance || !hasUsers) {
        setStepError('Please select instance and upload a valid file');
        return;
      }
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
    }));
    setUploadSuccess('');
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
            <ExcelUploadSection
              onUploaded={handleUploaded}
              onError={handleUploadError}
              disabled={false}
              showCampaignSettingsButton={false}
              instances={instances}
              selectedInstanceId={wizardData.selectedInstanceId}
              onSelectInstance={setSelectedInstanceId}
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
            <CampaignSettingsForm
              value={wizardData.campaignSettings}
              onChange={(updated) => {
                setStepError('');
                setWizardData((prev) => ({
                  ...prev,
                  campaignSettings: updated,
                }));
              }}
              error={stepError || undefined}
            />
          </>
        ) : currentStep === 3 ? (
          <>
            <h2 className="test-message-modal__title" style={{ marginTop: 0 }}>
              Test campaign (optional)
            </h2>
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
        ) : currentStep === 4 ? (
          <CampaignReviewStep
            uploadResult={wizardData.uploadResult}
            selectedInstanceId={wizardData.selectedInstanceId}
            instances={instances}
            campaignSettings={wizardData.campaignSettings}
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
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
                setStepError('');
                setWizardData((prev) => ({
                  ...prev,
                  testState: { ...prev.testState, status: 'skipped' },
                }));
                goToStep(4);
              }}
            >
              Skip
            </Button>
          ) : null}

          {currentStep < TOTAL_STEPS ? (
            <Button type="button" className="ui-button--inline" onClick={nextStep}>
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
