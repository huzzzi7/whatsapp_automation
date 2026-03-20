import { useState, useCallback, useEffect, useRef } from 'react';
import { createAppUser, listAppUsers, updateAppUser, deleteAppUser } from '../api';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

export default function CreateUserPage() {
  const modalRef = useRef(null);
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('USER');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const data = await listAppUsers();
      setUsers(data);
    } catch (err) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[CreateUserPage] users', users);
    }
  }, [users]);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        setIsModalOpen(false);
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') setIsModalOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isModalOpen]);

  useEffect(() => {
    if (!isModalOpen) return;
    if (editingUser) {
      setName(editingUser.name || '');
      setEmail(editingUser.email || '');
      setRole(editingUser.role || 'USER');
      setPassword('');
      setConfirmPassword('');
      return;
    }
    setName('');
    setEmail('');
    setRole('USER');
    setPassword('');
    setConfirmPassword('');
  }, [isModalOpen, editingUser]);

  const openCreateModal = () => {
    setEditingUser(null);
    setIsModalOpen(true);
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
  };

  const handleDelete = async (user) => {
    const confirmed = window.confirm('Are you sure you want to delete this user?');
    if (!confirmed) return;
    setError('');
    setSuccess('');
    try {
      await deleteAppUser(user.id);
      setSuccess('User deleted successfully.');
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to delete user');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    if ((password || confirmPassword) && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!editingUser && !password) {
      setError('Password is required');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      if (editingUser) {
        await updateAppUser(editingUser.id, {
          name: name.trim(),
          email: email.trim(),
          role,
          ...(password ? { password } : {}),
        });
        setSuccess('User updated successfully.');
      } else {
        await createAppUser({
          name: name.trim(),
          email: email.trim(),
          role,
          password,
        });
        setSuccess('User created. They can log in with this email and password.');
      }
      closeModal();
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Users</h1>
        <Button type="button" className="ui-button--inline" onClick={openCreateModal}>
          Add New User
        </Button>
      </div>

      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>Manage dashboard users and permissions.</p>

      {error && <div className="alert-error">{error}</div>}
      {success && <div className="alert-success">{success}</div>}

      <Card>
        {loadingUsers ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Loading users…</p>
        ) : users.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>No users found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Email</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Role</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Created At</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ padding: '0.5rem', borderTop: '1px solid var(--border)' }}>{u.name || '-'}</td>
                    <td style={{ padding: '0.5rem', borderTop: '1px solid var(--border)' }}>{u.email}</td>
                    <td style={{ padding: '0.5rem', borderTop: '1px solid var(--border)' }}>{u.role}</td>
                    <td style={{ padding: '0.5rem', borderTop: '1px solid var(--border)' }}>
                      {u.createdAt ? new Date(u.createdAt).toLocaleString() : '-'}
                    </td>
                    <td style={{ padding: '0.5rem', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button
                          type="button"
                          onClick={() => openEditModal(u)}
                          title="Edit user"
                          aria-label="Edit user"
                          style={{ border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 6, cursor: 'pointer' }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(u)}
                          title="Delete user"
                          aria-label="Delete user"
                          style={{ border: '1px solid #fecaca', background: '#fee2e2', borderRadius: 6, cursor: 'pointer' }}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isModalOpen ? (
        <div
          role="presentation"
          onClick={closeModal}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={editingUser ? 'Edit User' : 'Add New User'}
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', borderRadius: 10, padding: '1rem' }}
          >
            <h2 style={{ marginTop: 0 }}>{editingUser ? 'Edit User' : 'Add New User'}</h2>
            <form onSubmit={handleSubmit} style={{ maxWidth: 420 }}>
              <Input
                label="Name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="off"
              />
              <div className="ui-input-wrap">
                <label className="ui-input-label" htmlFor="create-user-role">
                  Role
                </label>
                <select
                  id="create-user-role"
                  className="ui-input-field"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <Input
                label={editingUser ? 'Password (optional)' : 'Password'}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!editingUser}
                autoComplete="new-password"
              />
              <Input
                label={editingUser ? 'Confirm password (optional)' : 'Confirm password'}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required={!editingUser}
                autoComplete="new-password"
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button type="button" className="ui-button--inline ui-button--secondary" onClick={closeModal}>
                  Cancel
                </Button>
                <Button type="submit" loading={loading} disabled={loading}>
                  {editingUser ? 'Update User' : 'Create User'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
