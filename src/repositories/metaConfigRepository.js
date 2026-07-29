/**
 * DB access for meta_config (singleton Meta Cloud API connection settings).
 */
const pool = require('../mysql');

const META_CONFIG_ID = 1;

/** @returns {Promise<{id:number, phoneNumberId:string, accessToken:string, graphVersion:string, isEnabled:boolean}|null>} */
async function getMetaConfigRow() {
  const [rows] = await pool.execute('SELECT * FROM meta_config WHERE id = ? LIMIT 1', [META_CONFIG_ID]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    phoneNumberId: row.phoneNumberId != null ? String(row.phoneNumberId) : '',
    accessToken: row.accessToken != null ? String(row.accessToken) : '',
    graphVersion: row.graphVersion != null ? String(row.graphVersion) : '',
    isEnabled: Number(row.isEnabled) === 1,
  };
}

module.exports = { getMetaConfigRow };
