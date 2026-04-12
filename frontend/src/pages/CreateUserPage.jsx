import { useState, useCallback, useEffect, useRef } from 'react';
import { createAppUser, listAppUsers, updateAppUser, deleteAppUser } from '../api';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

function IconPencil() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

export default function CreateUserPage() {
  const formModalRef = useRef(null);
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('USER');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

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
    if (!isModalOpen && !confirmDeleteUser) return undefined;
    const handleEsc = (e) => {
      if (e.key !== 'Escape') return;
      if (confirmDeleteUser) setConfirmDeleteUser(null);
      else if (isModalOpen) {
        setIsModalOpen(false);
        setEditingUser(null);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isModalOpen, confirmDeleteUser]);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const handleClickOutside = (e) => {
      if (formModalRef.current && !formModalRef.current.contains(e.target)) {
        setIsModalOpen(false);
        setEditingUser(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const executeDeleteUser = async () => {
    const user = confirmDeleteUser;
    if (!user) return;
    setConfirmDeleteUser(null);
    setError('');
    setSuccess('');
    setDeleteBusy(true);
    try {
      await deleteAppUser(user.id);
      setSuccess('User deleted successfully.');
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to delete user');
    } finally {
      setDeleteBusy(false);
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
    <div className="create-user-page campaign-details-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Users</h1>
        <Button type="button" className="ui-button--inline" onClick={openCreateModal}>
          Add New User
        </Button>
      </div>

      <p style={{ marginBottom: '1.5rem', color: 'var(--text-muted)' }}>Manage dashboard users and permissions.</p>

      {error ? (
        <div className="alert-error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="alert-success" style={{ marginBottom: '1rem' }}>
          {success}
        </div>
      ) : null}

      <div className="campaign-details__grid">
        <Card className="campaign-details__section">
          <h2 className="campaign-details__section-title">Users</h2>
          {loadingUsers ? (
            <p className="muted">Loading users…</p>
          ) : users.length === 0 ? (
            <p className="campaign-details__empty">No users found.</p>
          ) : (
            <div className="campaign-details__table-wrap">
              <table className="campaign-details__table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name || '—'}</td>
                      <td>{u.email}</td>
                      <td>{u.role}</td>
                      <td>{u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}</td>
                      <td className="campaign-details__history-actions">
                        <div className="campaign-details__history-actions-inner">
                          <button
                            type="button"
                            className="campaign-details__icon-btn"
                            title="Edit user"
                            aria-label="Edit user"
                            onClick={() => openEditModal(u)}
                          >
                            <IconPencil />
                          </button>
                          <button
                            type="button"
                            className="btn-delete btn-icon"
                            title="Delete user"
                            aria-label="Delete user"
                            onClick={() => setConfirmDeleteUser(u)}
                          >
                            <IconTrash />
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
      </div>

      {isModalOpen ? (
        <div className="modal-overlay" role="presentation" onClick={closeModal}>
          <div
            ref={formModalRef}
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-form-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="create-user-form-modal-title" className="modal-title">
                {editingUser ? 'Edit user' : 'Add new user'}
              </h3>
              <button type="button" className="modal-close" aria-label="Close" onClick={closeModal}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <form id="create-user-form" onSubmit={handleSubmit}>
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
              </form>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={closeModal}>
                Cancel
              </button>
              <Button
                type="submit"
                form="create-user-form"
                className="ui-button--inline"
                loading={loading}
                disabled={loading}
              >
                {editingUser ? 'Update user' : 'Create user'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDeleteUser ? (
        <div className="modal-overlay" role="presentation" onClick={() => setConfirmDeleteUser(null)}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-delete-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="create-user-delete-modal-title" className="modal-title">
                Delete user
              </h3>
              <button
                type="button"
                className="modal-close"
                aria-label="Close"
                onClick={() => setConfirmDeleteUser(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to delete{' '}
                <strong>{confirmDeleteUser.name || confirmDeleteUser.email || 'this user'}</strong>? This cannot be
                undone.
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setConfirmDeleteUser(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={deleteBusy}
                onClick={() => void executeDeleteUser()}
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
