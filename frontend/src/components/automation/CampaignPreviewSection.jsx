import UniversityBlock from './UniversityBlock';
import Button from '../ui/Button';

function formatHms(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function CampaignPreviewSection({
  uploadResult,
  onSendAll,
  onSendUniversity,
  onTestClick = () => {},
  campaignBusy = false,
  statusText,
  statusType,
  instanceReady,
  sendAllDisabled = false,
  globalProgress = null,
  universityJobs = {},
  sendDisabledByUniversity = () => false,
}) {
  if (!uploadResult) return null;

  const universities = uploadResult.universities ?? [];
  const totalUsers = uploadResult.totalUsers ?? 0;
  const byUniversity = uploadResult.byUniversity ?? {};

  const statusClass =
    statusType === 'success'
      ? 'campaign-status campaign-status--success'
      : statusType === 'error'
        ? 'campaign-status campaign-status--error'
        : 'campaign-status';

  const sendDisabled = sendAllDisabled || campaignBusy || !uploadResult.users?.length || !instanceReady;
  const testDisabled = campaignBusy || !instanceReady;
  const showCollapsedGlobal = Boolean(globalProgress);

  return (
    <section className="automation-section campaign-preview-section">
      <div className="campaign-preview-section__header-row">
        <h2>Campaign preview</h2>
        <div className="automation-preview-actions campaign-preview-section__actions">
          <Button
            type="button"
            className="send-all-btn ui-button--inline"
            onClick={onSendAll}
            disabled={sendDisabled}
            aria-label="Send campaign message 1 to all users in the preview"
          >
            Send all
          </Button>
          <Button
            type="button"
            className="test-msg-btn ui-button--inline ui-button--secondary"
            onClick={onTestClick}
            disabled={testDisabled}
            aria-label="Open test dialog (sends first message; reply for rest)"
          >
            Test
          </Button>
        </div>
      </div>
      <p className="campaign-preview-section__summary">
        <strong>{totalUsers}</strong> users from <strong>{universities.length}</strong> universities.
      </p>

      {statusText ? <div className={statusClass}>{statusText}</div> : null}

      {globalProgress ? (
        <div style={{ marginBottom: '1rem', padding: '0.75rem', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <div style={{ marginBottom: '0.4rem' }}>
            Progress: {Math.round(globalProgress.percentage)}% ({globalProgress.processedUsers}/{globalProgress.totalUsers})
          </div>
          <div style={{ height: 10, background: '#e5e7eb', borderRadius: 9999, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(0, Math.min(100, globalProgress.percentage))}%`,
                height: '100%',
                background: '#2563eb',
              }}
            />
          </div>
          <div style={{ marginTop: '0.35rem', color: 'var(--text-muted)' }}>
            Remaining: {formatHms(globalProgress.remainingSeconds)}
          </div>
        </div>
      ) : null}

      <div className="university-blocks-list">
        {(showCollapsedGlobal ? [] : uploadResult.universities).map((uni) => (
          <UniversityBlock
            key={uni}
            name={uni}
            users={byUniversity[uni] ?? []}
            onSendUniversity={onSendUniversity}
            startingCampaign={sendDisabledByUniversity(uni)}
            progressJob={universityJobs[uni] || null}
            forceCollapsed={Boolean(universityJobs[uni])}
          />
        ))}
      </div>
    </section>
  );
}
