/**
 * DB access for meta_templates (registered Meta Cloud API templates for campaigns).
 */
const pool = require('../mysql');

function mapTemplateRow(row) {
  if (!row) return null;
  let variables = [];
  try {
    const parsed = typeof row.variables === 'string' ? JSON.parse(row.variables) : row.variables;
    if (Array.isArray(parsed)) variables = parsed.map((v) => String(v));
  } catch {
    variables = [];
  }
  return {
    id: row.id,
    name: row.name,
    languageCode: row.language_code,
    category: row.category ?? null,
    variables,
    hasOptOutButton: Number(row.has_opt_out_button) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listMetaTemplates() {
  const [rows] = await pool.execute('SELECT * FROM meta_templates ORDER BY name ASC');
  return rows.map(mapTemplateRow);
}

async function getMetaTemplateById(id) {
  const templateId = Number(id);
  if (!Number.isFinite(templateId)) return null;
  const [rows] = await pool.execute('SELECT * FROM meta_templates WHERE id = ? LIMIT 1', [templateId]);
  return mapTemplateRow(rows[0]);
}

async function createMetaTemplate({ name, languageCode, category = null, variables = [] }) {
  const [result] = await pool.execute(
    `INSERT INTO meta_templates (name, language_code, category, variables) VALUES (?, ?, ?, ?)`,
    [
      String(name).trim(),
      String(languageCode).trim(),
      category != null && String(category).trim() !== '' ? String(category).trim() : null,
      JSON.stringify(Array.isArray(variables) ? variables.map((v) => String(v).trim()).filter(Boolean) : []),
    ],
  );
  return getMetaTemplateById(result.insertId);
}

async function updateMetaTemplate(id, { name, languageCode, category = null, variables = [] }) {
  const templateId = Number(id);
  if (!Number.isFinite(templateId)) return null;
  await pool.execute(
    `UPDATE meta_templates SET name = ?, language_code = ?, category = ?, variables = ? WHERE id = ?`,
    [
      String(name).trim(),
      String(languageCode).trim(),
      category != null && String(category).trim() !== '' ? String(category).trim() : null,
      JSON.stringify(Array.isArray(variables) ? variables.map((v) => String(v).trim()).filter(Boolean) : []),
      templateId,
    ],
  );
  return getMetaTemplateById(templateId);
}

async function deleteMetaTemplate(id) {
  const templateId = Number(id);
  if (!Number.isFinite(templateId)) return 0;
  const [result] = await pool.execute('DELETE FROM meta_templates WHERE id = ?', [templateId]);
  return Number(result.affectedRows) || 0;
}

/**
 * @param {number|string} id
 * @param {boolean} value
 */
async function setHasOptOutButton(id, value) {
  const templateId = Number(id);
  if (!Number.isFinite(templateId)) return null;
  await pool.execute('UPDATE meta_templates SET has_opt_out_button = ? WHERE id = ?', [value ? 1 : 0, templateId]);
  return getMetaTemplateById(templateId);
}

module.exports = {
  listMetaTemplates,
  getMetaTemplateById,
  createMetaTemplate,
  updateMetaTemplate,
  deleteMetaTemplate,
  setHasOptOutButton,
};
