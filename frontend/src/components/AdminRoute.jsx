import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AdminRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user || String(user.role || '').toLowerCase() !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return children;
}
