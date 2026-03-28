import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function navClass({ isActive }) {
  return `sidebar-link${isActive ? ' sidebar-link--active' : ''}`;
}

export default function Sidebar() {
  const { user } = useAuth();

  return (
    <nav
      style={{
        width: '240px',
        flexShrink: 0,
        background: 'var(--surface)',
        padding: '20px 16px',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: '15px',
          color: 'var(--text-primary)',
          marginBottom: '24px',
          letterSpacing: '-0.02em',
        }}
      >
        WhatsApp Automation
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, flex: 1 }}>
        <li style={{ marginBottom: '4px' }}>
          <NavLink to="/" end className={navClass}>
            Home
          </NavLink>
        </li>
        {String(user?.role || '').toLowerCase() === 'admin' && (
          <li style={{ marginBottom: '4px' }}>
            <NavLink to="/settings" className={navClass}>
              Settings
            </NavLink>
          </li>
        )}
        <li style={{ marginBottom: '4px' }}>
          <NavLink to="/campaign" className={navClass}>
            Campaign
          </NavLink>
        </li>
        {String(user?.role || '').toLowerCase() === 'admin' && (
          <li style={{ marginBottom: '4px' }}>
            <NavLink to="/create-user" className={navClass}>
              Create User
            </NavLink>
          </li>
        )}
      </ul>
    </nav>
  );
}
