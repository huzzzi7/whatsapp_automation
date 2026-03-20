import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function readTheme() {
  return document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'dark';
}

function toggleTheme(setTheme) {
  const current = readTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  setTheme(next);
}

/** Sun — shown in dark mode; activates light theme */
function IconSun({ title }) {
  return (
    <svg
      className="topbar-theme-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

/** Moon — shown in light mode; activates dark theme */
function IconMoon({ title }) {
  return (
    <svg
      className="topbar-theme-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {title ? <title>{title}</title> : null}
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isDark = theme === 'dark';

  return (
    <header
      style={{
        height: '60px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 20px',
        background: 'var(--surface)',
        flexShrink: 0,
      }}
    >
      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Dashboard</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}>
        <span style={{ color: 'var(--text-muted)' }}>{user?.email}</span>
        {user?.role === 'ADMIN' && (
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--primary)',
              background: 'var(--accent-bg)',
              padding: '2px 8px',
              borderRadius: '6px',
            }}
          >
            Admin
          </span>
        )}
        <button
          type="button"
          className="topbar-theme-btn"
          onClick={() => toggleTheme(setTheme)}
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          title={isDark ? 'Light mode' : 'Dark mode'}
        >
          {isDark ? <IconSun /> : <IconMoon />}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="topbar-logout"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
