import { useState, useId } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import CampaignUsersTable from './CampaignUsersTable';

function formatHms(totalSeconds) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return '—';
  const safe = Math.max(0, Math.floor(Number(totalSeconds)));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function UniversityBlock({
  name,
  users,
  onSendUniversity,
  startingCampaign,
  progressJob = null,
  forceCollapsed = false,
}) {
  const list = users ?? [];
  const [collapsed, setCollapsed] = useState(false);
  const panelId = useId();

  const toggle = () => setCollapsed((c) => !c);

  const onHeaderKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };

  return (
    <Card className="university-block-card">
      <div
        className="university-block__header"
        onClick={toggle}
        onKeyDown={onHeaderKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-controls={panelId}
      >
        <h3 className="university-block__title">
          {name} ({list.length} users)
        </h3>
        <div className="university-block__header-actions">
          <Button
            type="button"
            className="ui-button--inline"
            disabled={startingCampaign || !list.length}
            onClick={(e) => {
              e.stopPropagation();
              onSendUniversity(list, name);
            }}
          >
            Send to this university
          </Button>
          <span className="university-block__chevron" aria-hidden>
            {collapsed ? '+' : '−'}
          </span>
        </div>
      </div>

      {progressJob ? (
        <div style={{ padding: '0 1rem 0.75rem' }}>
          <div style={{ marginBottom: '0.4rem' }}>
            Progress: {Math.round(progressJob.percentage)}% ({progressJob.processedUsers}/{progressJob.totalUsers})
          </div>
          <div style={{ height: 8, background: '#e5e7eb', borderRadius: 9999, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(0, Math.min(100, progressJob.percentage))}%`,
                height: '100%',
                background: '#2563eb',
              }}
            />
          </div>
          <div style={{ marginTop: '0.35rem', color: 'var(--text-muted)' }}>
            Remaining: {formatHms(progressJob.remainingSeconds)}
          </div>
        </div>
      ) : null}

      <div
        id={panelId}
        role="region"
        aria-label={`${name} recipients`}
        className={`university-block__collapsible${(collapsed || forceCollapsed) ? '' : ' university-block__collapsible--open'}`}
      >
        <div className="university-block__collapsible-inner" inert={(collapsed || forceCollapsed) ? true : undefined}>
          <CampaignUsersTable users={list} />
        </div>
      </div>
    </Card>
  );
}
