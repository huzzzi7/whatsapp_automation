/**
 * DB access for university_links — admin-maintained University -> WhatsApp group link / ticket
 * link map, used for the "different uni" branch of the reply sequence and the AI reply pipeline.
 */
const pool = require('../mysql');

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    universityName: row.university_name,
    groupLink: row.group_link,
    ticketLink: row.ticket_link,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Shape returned by findUniversityLinkCandidates — just the fields a resolver/reply needs. */
function mapCandidateRow(row) {
  return {
    universityName: row.university_name,
    groupLink: row.group_link,
    ticketLink: row.ticket_link,
  };
}

async function listUniversityLinks() {
  const [rows] = await pool.execute('SELECT * FROM university_links ORDER BY university_name ASC');
  return rows.map(mapRow);
}

async function createUniversityLink({ universityName, groupLink, ticketLink }) {
  const [result] = await pool.execute(
    'INSERT INTO university_links (university_name, group_link, ticket_link) VALUES (?, ?, ?)',
    [String(universityName).trim(), groupLink ? String(groupLink).trim() : null, ticketLink ? String(ticketLink).trim() : null],
  );
  const [rows] = await pool.execute('SELECT * FROM university_links WHERE id = ? LIMIT 1', [result.insertId]);
  return mapRow(rows[0]);
}

async function updateUniversityLink(id, { universityName, groupLink, ticketLink }) {
  const linkId = Number(id);
  if (!Number.isFinite(linkId)) return null;
  await pool.execute(
    'UPDATE university_links SET university_name = ?, group_link = ?, ticket_link = ? WHERE id = ?',
    [String(universityName).trim(), groupLink ? String(groupLink).trim() : null, ticketLink ? String(ticketLink).trim() : null, linkId],
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
 * Case-insensitive exact match first; if none, a tolerant substring match either direction
 * (handles "Kent" matching a stored "University of Kent", and vice versa) returning EVERY
 * matching university rather than silently picking one — a name like "Leeds" genuinely matches
 * several distinct real universities, and callers need to know that to ask which one rather than
 * guess.
 * @param {string} universityName - free-text name as typed/extracted from the recipient
 * @returns {Promise<{universityName:string, groupLink:string|null, ticketLink:string|null}[]>}
 *   [] if nothing matched, [one] if unambiguous, [multiple] if genuinely ambiguous
 */
async function findUniversityLinkCandidates(universityName) {
  const name = String(universityName || '').trim();
  if (!name) return [];

  const [exact] = await pool.execute(
    'SELECT university_name, group_link, ticket_link FROM university_links WHERE LOWER(university_name) = LOWER(?) LIMIT 1',
    [name],
  );
  if (exact[0]) return [mapCandidateRow(exact[0])];

  // LENGTH guard avoids short stored abbreviations (e.g. "LSE") causing accidental substring
  // matches against unrelated free text.
  const [fuzzy] = await pool.execute(
    `SELECT university_name, group_link, ticket_link FROM university_links
     WHERE LENGTH(university_name) >= 4
       AND (
         LOWER(?) LIKE CONCAT('%', LOWER(university_name), '%')
         OR (LENGTH(?) >= 4 AND LOWER(university_name) LIKE CONCAT('%', LOWER(?), '%'))
       )
     ORDER BY LENGTH(university_name) DESC`,
    [name, name, name],
  );
  return fuzzy.map(mapCandidateRow);
}

/**
 * Convenience wrapper for exact-name lookups where ambiguity isn't a concern (e.g. looking up the
 * full details of an already-confirmed, canonical university name stored on a conversation).
 * @param {string} universityName
 * @returns {Promise<{universityName:string, groupLink:string|null, ticketLink:string|null}|null>}
 */
async function findUniversityLinkExact(universityName) {
  const candidates = await findUniversityLinkCandidates(universityName);
  return candidates.length === 1 ? candidates[0] : null;
}

module.exports = {
  listUniversityLinks,
  createUniversityLink,
  updateUniversityLink,
  deleteUniversityLink,
  findUniversityLinkCandidates,
  findUniversityLinkExact,
};
