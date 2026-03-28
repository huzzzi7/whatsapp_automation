const STEPS = [
  { number: 1, label: 'Upload' },
  { number: 2, label: 'Settings' },
  { number: 3, label: 'Test' },
  { number: 4, label: 'Start' },
];

export default function CampaignStepper({ currentStep }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: '1.25rem',
      }}
    >
      {STEPS.map((step) => {
        const isActive = currentStep === step.number;
        const isCompleted = currentStep > step.number;
        return (
          <div
            key={step.number}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.4rem 0.6rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: isActive ? 'var(--surface)' : 'transparent',
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: '999px',
                display: 'grid',
                placeItems: 'center',
                fontSize: '12px',
                fontWeight: 700,
                border: '1px solid var(--border)',
                background: isCompleted ? 'var(--text-primary)' : 'var(--bg)',
                color: isCompleted ? 'var(--bg)' : 'var(--text-primary)',
              }}
            >
              {step.number}
            </div>
            <span
              style={{
                fontSize: '13px',
                fontWeight: isActive ? 600 : 500,
                color: 'var(--text-primary)',
              }}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
