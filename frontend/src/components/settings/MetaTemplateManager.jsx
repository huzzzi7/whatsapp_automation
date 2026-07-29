import { useCallback, useEffect, useState } from 'react';
import Button from '../ui/Button';
import { listMetaTemplates, createMetaTemplate, updateMetaTemplate, deleteMetaTemplate } from '../../api';

const EMPTY_FORM = { name: '', languageCode: 'en_GB', category: '', variables: [''] };

export default function MetaTemplateManager() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listMetaTemplates();
      setTemplates(list);
    } catch (e) {
      setError(e.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (t) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      languageCode: t.languageCode,
      category: t.category || '',
      variables: t.variables.length > 0 ? t.variables : [''],
    });
    setMessage('');
    setError('');
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setMessage('');
    setError('');
  };

  const handleField = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const updateVariable = (index, value) => {
    setForm((prev) => {
      const next = [...prev.variables];
      next[index] = value;
      return { ...prev, variables: next };
    });
  };

  const addVariable = () => {
    setForm((prev) => ({ ...prev, variables: [...prev.variables, ''] }));
  };

  const removeVariable = (index) => {
    setForm((prev) => ({ ...prev, variables: prev.variables.filter((_, i) => i !== index) }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        name: form.name.trim(),
        languageCode: form.languageCode.trim(),
        category: form.category.trim(),
        variables: form.variables.map((v) => v.trim()).filter(Boolean),
      };
      if (!payload.name || !payload.languageCode) {
        setError('Name and language are required.');
        return;
      }
      if (editingId) {
        await updateMetaTemplate(editingId, payload);
        setMessage('Template updated.');
      } else {
        await createMetaTemplate(payload);
        setMessage('Template added.');
      }
      startCreate();
      await load();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete template "${t.name}"? Campaigns using it will need a different template.`)) return;
    setError('');
    setMessage('');
    try {
      await deleteMetaTemplate(t.id);
      if (editingId === t.id) startCreate();
      await load();
    } catch (e) {
      setError(e.message || 'Delete failed');
    }
  };

  return (
    <div>
      {error ? <div className="alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div> : null}
      {message ? (
        <div
          style={{
            marginBottom: '0.75rem',
            padding: '0.6rem 0.85rem',
            borderRadius: 8,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
          }}
        >
          {message}
        </div>
      ) : null}

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading templates…</p>
      ) : templates.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No templates registered yet.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.4rem 0.6rem' }}>Name</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Language</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Category</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Variables</th>
                <th style={{ padding: '0.4rem 0.6rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.4rem 0.6rem' }}>{t.name}</td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>{t.languageCode}</td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>{t.category || '—'}</td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>
                    {t.variables.length > 0
                      ? t.variables.map((v) => `{{${v}}}`).join(', ')
                      : '— (no variables)'}
                  </td>
                  <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' }}>
                    <Button
                      type="button"
                      className="ui-button--inline ui-button--secondary"
                      onClick={() => startEdit(t)}
                    >
                      Edit
                    </Button>{' '}
                    <Button
                      type="button"
                      className="ui-button--inline ui-button--secondary"
                      onClick={() => handleDelete(t)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div
        style={{
          maxWidth: 480,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid var(--border)',
        }}
      >
        <strong style={{ fontSize: '0.9rem' }}>{editingId ? 'Edit template' : 'Add template'}</strong>
        <div>
          <label className="ui-input-label" htmlFor="meta-template-name">
            Template name (must match Meta exactly)
          </label>
          <input
            id="meta-template-name"
            className="ui-input-field"
            value={form.name}
            onChange={handleField('name')}
            placeholder="leeds"
          />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 1 140px' }}>
            <label className="ui-input-label" htmlFor="meta-template-lang">
              Language code
            </label>
            <input
              id="meta-template-lang"
              className="ui-input-field"
              value={form.languageCode}
              onChange={handleField('languageCode')}
              placeholder="en_GB"
            />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label className="ui-input-label" htmlFor="meta-template-category">
              Category (optional)
            </label>
            <input
              id="meta-template-category"
              className="ui-input-field"
              value={form.category}
              onChange={handleField('category')}
              placeholder="MARKETING"
            />
          </div>
        </div>

        <div>
          <span className="ui-input-label">Variables (bare names, e.g. "group" for {'{{group}}'})</span>
          {form.variables.map((v, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.4rem' }}>
              <input
                className="ui-input-field"
                value={v}
                onChange={(e) => updateVariable(i, e.target.value)}
                placeholder="group"
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', minWidth: 90 }}>
                {v.trim() ? `{{${v.trim()}}}` : ''}
              </span>
              <Button
                type="button"
                className="ui-button--inline ui-button--secondary"
                onClick={() => removeVariable(i)}
                disabled={form.variables.length <= 1}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            className="ui-button--inline ui-button--secondary"
            style={{ marginTop: '0.5rem' }}
            onClick={addVariable}
          >
            Add variable
          </Button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button type="button" className="ui-button--inline" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add template'}
          </Button>
          {editingId ? (
            <Button type="button" className="ui-button--inline ui-button--secondary" onClick={startCreate}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
