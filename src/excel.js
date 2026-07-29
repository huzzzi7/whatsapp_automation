/**
 * Read original.xlsx (column-based layout).
 *
 * NEW (rows.length >= 5): row 1=link, row 2=city, row 3=group, row 4=university, row 5+=phones.
 *   (Phone data starts at row index 4; no URL heuristics.)
 * OLD (rows.length < 5): row 1=link, row 2=city, row 3=university, row 4+=phones, group=''.
 *
 * A classic 3-header + 1 phone sheet has exactly 4 rows and stays OLD. NEW layout needs four metadata
 * rows (link, city, group, university) plus at least one phone row (rows.length >= 5).
 */
const XLSX = require('xlsx');
const { normalizePhone } = require('./phone');

/**
 * Read Excel file and build user list: one entry per non-empty phone, with university/city/link/group from column.
 * Normalizes phones, dedupes by phone (keep first), sorts by university then city.
 * @param {string} filePath - Path to original.xlsx
 * @param {string} defaultCountryCode - For phone normalization
 * @returns {Promise<Array<{ phone: string, university: string, city: string, link: string, group: string }>>}
 */
async function readExcel(filePath, defaultCountryCode = '44') {
  let workbook;
  try {
    workbook = XLSX.readFile(filePath);
  } catch (err) {
    throw new Error(`Failed to read Excel file "${filePath}": ${err.message}`);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

  // Convert to array of rows (each row = array of cell values)
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return parseRowsToUsers(rows, defaultCountryCode);
}

/**
 * Read Excel from an in-memory buffer (e.g. uploaded file). Same column-based layouts as readExcel.
 * @param {Buffer} buffer - Excel file bytes
 * @param {string} defaultCountryCode - For phone normalization
 * @returns {Array<{ phone: string, university: string, city: string, link: string, group: string }>}
 */
function readExcelFromBuffer(buffer, defaultCountryCode = '44') {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    throw new Error(`Failed to read Excel from buffer: ${err.message}`);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return parseRowsToUsers(rows, defaultCountryCode);
}

/**
 * Parse column-based rows into sorted user list (NEW vs OLD by row count only).
 */
function parseRowsToUsers(rows, defaultCountryCode) {
  if (!rows.length) return [];

  const newFormat = rows.length >= 5;
  const phoneStartRow = newFormat ? 4 : 3;

  const maxCol = Math.max(
    0,
    ...rows.map((r) => (r && r.length) || 0),
  );

  const users = [];
  const seenPhones = new Set();

  for (let col = 0; col < maxCol; col++) {
    let group;
    let link;
    let city;
    let university;

    if (newFormat) {
      link = cellValue(rows[0]?.[col]) || '';
      city = cellValue(rows[1]?.[col]) || '';
      group = cellValue(rows[2]?.[col]) || '';
      university = cellValue(rows[3]?.[col]) || '';
    } else {
      group = '';
      link = cellValue(rows[0]?.[col]) || '';
      city = cellValue(rows[1]?.[col]) || '';
      university = cellValue(rows[2]?.[col]) || '';
    }

    for (let rowIndex = phoneStartRow; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] || [];
      const rawPhone = cellValue(row[col]);
      if (!rawPhone) continue;

      const phone = normalizePhone(rawPhone, defaultCountryCode);
      if (!phone) continue;
      if (seenPhones.has(phone)) continue;
      seenPhones.add(phone);

      users.push({ phone, university, city, link, group });
    }
  }

  users.sort((a, b) => {
    const u = (a.university || '').localeCompare(b.university || '');
    if (u !== 0) return u;
    return (a.city || '').localeCompare(b.city || '');
  });

  return users;
}

/** Coerce cell to string (handles numbers/dates from Excel). */
function cellValue(val) {
  if (val == null) return '';
  if (typeof val === 'number') return String(val).trim();
  return String(val).trim();
}

/**
 * Read Excel from an in-memory buffer using the conventional row-per-contact orientation:
 * row 1 = column headers, each subsequent row = one contact. Unlike readExcel/readExcelFromBuffer
 * (which are column-per-contact/transposed), this produces one plain object per row keyed by
 * trimmed/lowercased header, with no fixed field list. A "phone" column is required.
 * @param {Buffer} buffer - Excel file bytes
 * @param {string} defaultCountryCode - For phone normalization
 * @returns {Array<object>} one object per contact, always includes a normalized `phone`
 */
function readExcelHeaderBasedFromBuffer(buffer, defaultCountryCode = '44') {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    throw new Error(`Failed to read Excel from buffer: ${err.message}`);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return parseHeaderRowsToUsers(rows, defaultCountryCode);
}

/**
 * Parse row-based rows (row 1 = headers) into a list of plain per-contact objects.
 */
function parseHeaderRowsToUsers(rows, defaultCountryCode) {
  if (!rows.length) return [];

  const headers = (rows[0] || []).map((h) => cellValue(h).toLowerCase());
  const phoneCol = headers.indexOf('phone');
  if (phoneCol === -1) {
    throw new Error('Sheet must have a "phone" column header.');
  }

  const users = [];
  const seenPhones = new Set();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const rawPhone = cellValue(row[phoneCol]);
    if (!rawPhone) continue;

    const phone = normalizePhone(rawPhone, defaultCountryCode);
    if (!phone) continue;
    if (seenPhones.has(phone)) continue;
    seenPhones.add(phone);

    const user = {};
    for (let col = 0; col < headers.length; col++) {
      const header = headers[col];
      if (!header) continue;
      user[header] = header === 'phone' ? phone : cellValue(row[col]);
    }
    users.push(user);
  }

  return users;
}

module.exports = { readExcel, readExcelFromBuffer, readExcelHeaderBasedFromBuffer };
