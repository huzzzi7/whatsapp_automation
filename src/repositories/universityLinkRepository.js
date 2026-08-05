/**
 * DB access for university_links — admin-maintained University -> WhatsApp group link map,
 * used for the "different uni" branch of the reply sequence.
 */
const pool = require('../mysql');

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    universityName: row.university_name,
    groupLink: row.group_link,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listUniversityLinks() {
  const [rows] = await pool.execute('SELECT * FROM university_links ORDER BY university_name ASC');
  return rows.map(mapRow);
}

async function createUniversityLink({ universityName, groupLink }) {
  const [result] = await pool.execute(
    'INSERT INTO university_links (university_name, group_link) VALUES (?, ?)',
    [String(universityName).trim(), String(groupLink).trim()],
  );
  const [rows] = await pool.execute('SELECT * FROM university_links WHERE id = ? LIMIT 1', [result.insertId]);
  return mapRow(rows[0]);
}

async function updateUniversityLink(id, { universityName, groupLink }) {
  const linkId = Number(id);
  if (!Number.isFinite(linkId)) return null;
  await pool.execute(
    'UPDATE university_links SET university_name = ?, group_link = ? WHERE id = ?',
    [String(universityName).trim(), String(groupLink).trim(), linkId],
  );
  const [rows] = await pool.execute('SELECT * FROM university_links WHERE id = ? LIMIT 1', [linkId]);
  return mapRow(rows[0]);
}

async function deleteUniversityLink(id) {
  const linkId = Number(id);
  if (!Number.isFinite(linkId)) return 0;
  const [result] = await pool.execute('DELETE FROM university_links WHERE id = ?', [linkId]);
  return Number(result.affectedRows) || 0;
}

/**
 * Case-insensitive exact match first, then a tolerant substring match either direction
 * (handles "Kent" matching a stored "University of Kent", and vice versa).
 * @param {string} universityName - free-text name as typed by the recipient
 * @returns {Promise<string|null>} the matched group link, or null if nothing matched
 */
async function findUniversityLink(universityName) {
  const name = String(universityName || '').trim();
  if (!name) return null;

  const [exact] = await pool.execute(
    'SELECT group_link FROM university_links WHERE LOWER(university_name) = LOWER(?) LIMIT 1',
    [name],
  );
  if (exact[0]) return exact[0].group_link;

  // LENGTH guard avoids short stored abbreviations (e.g. "LSE") causing accidental substring
  // matches against unrelated free text.
  const [fuzzy] = await pool.execute(
    `SELECT group_link FROM university_links
     WHERE LENGTH(university_name) >= 4
       AND (
         LOWER(?) LIKE CONCAT('%', LOWER(university_name), '%')
         OR (LENGTH(?) >= 4 AND LOWER(university_name) LIKE CONCAT('%', LOWER(?), '%'))
       )
     ORDER BY LENGTH(university_name) DESC
     LIMIT 1`,
    [name, name, name],
  );
  return fuzzy[0]?.group_link ?? null;
}

module.exports = {
  listUniversityLinks,
  createUniversityLink,
  updateUniversityLink,
  deleteUniversityLink,
  findUniversityLink,
};
