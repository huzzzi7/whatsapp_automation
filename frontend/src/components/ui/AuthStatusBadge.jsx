export default function AuthStatusBadge({ authStatus }) {
  const s = String(authStatus || '').toLowerCase().trim();
  const isAuth = s === 'authorized' || s === 'connected' || s === 'yellowcard';
  const isUnauth = s === 'notauthorized' || s === 'blocked';
  const color = isAuth
    ? 'var(--color-success, #22c55e)'
    : isUnauth
      ? 'var(--color-danger, #ef4444)'
      : 'var(--text-muted, #9ca3af)';
  const label = isAuth ? 'Authorized' : isUnauth ? 'Unauthorized' : 'Unknown';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.8rem' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span style={{ color }}>{label}</span>
    </span>
  );
}
