/**
 * Read original.xlsx (column-based layout): row 1=links, row 2=cities, row 3=universities, row 4+=phones.
 * Returns sorted, deduplicated user list with normalized phones.
 */
const XLSX = require('xlsx');
const { normalizePhone } = require('./phone');

/**
 * Read Excel file and build user list: one entry per non-empty phone, with university/city/link from column.
 * Normalizes phones, dedupes by phone (keep first), sorts by university then city.
 * @param {string} filePath - Path to original.xlsx
 * @param {string} defaultCountryCode - For phone normalization
 * @returns {Promise<Array<{ phone: string, university: string, city: string, link: string }>>}
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
 * Read Excel from an in-memory buffer (e.g. uploaded file). Same column-based layout as readExcel.
 * @param {Buffer} buffer - Excel file bytes
 * @param {string} defaultCountryCode - For phone normalization
 * @returns {Array<{ phone: string, university: string, city: string, link: string }>}
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
 * Parse column-based rows (row1=links, row2=cities, row3=universities, row4+=phones) into sorted user list.
 */
function parseRowsToUsers(rows, defaultCountryCode) {
  if (!rows.length) return [];

  const row1 = rows[0] || [];
  const row2 = rows[1] || [];
  const row3 = rows[2] || [];
  const maxCol = Math.max(
    row1.length,
    row2.length,
    row3.length,
    ...rows.slice(3).map((r) => (r && r.length) || 0)
  );

  const users = [];
  const seenPhones = new Set();

  for (let col = 0; col < maxCol; col++) {
    const link = cellValue(row1[col]);
    const city = cellValue(row2[col]);
    const university = cellValue(row3[col]);

    for (let rowIndex = 3; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] || [];
      const rawPhone = cellValue(row[col]);
      if (!rawPhone) continue;

      const phone = normalizePhone(rawPhone, defaultCountryCode);
      if (!phone) continue;
      if (seenPhones.has(phone)) continue;
      seenPhones.add(phone);

      users.push({ phone, university, city, link });
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

module.exports = { readExcel, readExcelFromBuffer };
