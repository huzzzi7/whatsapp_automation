import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import SettingsPage from './pages/SettingsPage';
import AdminRoute from './components/AdminRoute';
import CreateUserPage from './pages/CreateUserPage';
import CampaignWizardPage from './pages/CampaignWizardPage';
import CampaignDetailsPage from './pages/CampaignDetailsPage';

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
          <Route path="campaign" element={<CampaignWizardPage />} />
          <Route path="campaign-details" element={<CampaignDetailsPage />} />
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
