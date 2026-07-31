import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import CampaignStepper from '../components/campaign/CampaignStepper';
import ExcelUploadSection from '../components/automation/ExcelUploadSection';
import { getConfig } from '../api';
import MetaCampaignSettingsForm, {
  normalizeMetaCampaignSettings,
  validateMetaCampaignSettings,
} from '../components/campaign/MetaCampaignSettingsForm';
import CampaignReviewStep from '../components/campaign/CampaignReviewStep';
import ExcelPreviewTable from '../components/campaign/ExcelPreviewTable';

const TOTAL_STEPS = 4;

export default function CampaignWizardPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState({
    provider: 'meta',
    uploadResult: null,
    metaSettings: normalizeMetaCampaignSettings({}),
    campaignJob: null,
  });
  const [rateConfig, setRateConfig] = useState({ rateLimitMessagesPerWindow: 3, rateLimitWindowMs: 60000 });
  const [campaignName, setCampaignName] = useState('');
  const [stepError, setStepError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  useEffect(() => {
    getConfig().then(setRateConfig).catch((err) => {
      console.warn('[CampaignWizard] getConfig failed, using defaults:', err?.message);
    });
  }, []);

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
    if (currentStep === 2) {
      const result = validateMetaCampaignSettings(wizardData.metaSettings);
      if (!result.ok) {
        setStepError(result.error);
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
            <ExcelUploadSection
              onUploaded={handleUploaded}
              onError={handleUploadError}
              disabled={false}
              showCampaignSettingsButton={false}
              provider="meta"
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
          </>
        ) : currentStep === 3 ? (
          <>
            <h2 className="test-message-modal__title" style={{ marginTop: 0 }}>
              Test campaign (optional)
            </h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '14px' }}>
              Use the "Send test template" tool on the Settings page to test this template before sending. Click
              Skip to continue to the full campaign.
            </p>
          </>
        ) : currentStep === 4 ? (
          <CampaignReviewStep
            provider="meta"
            uploadResult={wizardData.uploadResult}
            campaignName={campaignName}
            metaSettings={wizardData.metaSettings}
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
            Provider: Meta Cloud API
          </span>
        )}
      </div>
    </div>
  );
}
