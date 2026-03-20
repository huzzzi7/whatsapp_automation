import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import SettingsPage from './pages/SettingsPage';
import AutomationPage from './pages/AutomationPage';
import AdminRoute from './components/AdminRoute';
import CreateUserPage from './pages/CreateUserPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route
            path="settings"
            element={(
              <AdminRoute>
                <SettingsPage />
              </AdminRoute>
            )}
          />
          <Route path="send" element={<AutomationPage />} />
          <Route
            path="create-user"
            element={
              <AdminRoute>
                <CreateUserPage />
              </AdminRoute>
            }
          />
        </Route>
      </Route>
    </Routes>
  );
}
