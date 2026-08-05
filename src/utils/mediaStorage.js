/**
 * Local storage for WhatsApp media (inbound downloads + admin-sent uploads), since Meta's own
 * media URLs expire after 5 minutes and can't be relied on for later display in the chat UI.
 * Files are stored by a bare UUID filename; mime type is tracked separately (in the DB, or via
 * query param when serving) rather than encoded into the filename/extension.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const MEDIA_DIR = path.join(__dirname, '..', '..', 'uploads', 'inbound-media');

function ensureMediaDir() {
  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  }
}

/**
 * @param {Buffer} buffer
 * @returns {string} the generated filename (UUID, no extension)
 */
function writeMediaFile(buffer) {
  ensureMediaDir();
  const filename = randomUUID();
  fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
  return filename;
}

/**
 * @param {string} filename
 * @returns {string} absolute path on disk
 */
function mediaFilePath(filename) {
  return path.join(MEDIA_DIR, filename);
}

module.exports = { MEDIA_DIR, ensureMediaDir, writeMediaFile, mediaFilePath };
