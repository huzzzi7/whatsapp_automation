import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div
      className="layout"
      style={{
        display: 'flex',
        minHeight: '100vh',
        width: '100%',
        background: 'var(--bg)',
      }}
    >
      <Sidebar />
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <Topbar />
        <main
          className="main-content"
          style={{
            flex: 1,
            padding: '24px',
            overflow: 'auto',
            textAlign: 'left',
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
