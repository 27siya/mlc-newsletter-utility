/**
 * @fileoverview Shared helpers: validation, responses, logging, Drive lookups.
 * @version 1.0.0
 */

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, c => map[c]);
}

function sanitizeInput(input, maxLength = 300) {
  if (typeof input !== 'string') return '';
  return input.trim().substring(0, maxLength).replace(/[<>`]/g, '');
}

/**
 * Clean a filename without being precious about it. Admins name files however
 * they name them; we only strip what Drive or a URL would choke on.
 */
function sanitizeFileName(name, fallback = 'document') {
  if (typeof name !== 'string' || !name.trim()) return fallback;
  return name.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').substring(0, 200);
}

function createSuccess(data = null, message = 'Success') {
  return { success: true, message: message, data: data };
}

function createError(message, code = 'ERROR') {
  return { success: false, error: { message: String(message || 'An error occurred'), code: code } };
}

function logError_(component, error, context = {}) {
  Logger.log('ERROR [' + component + '] ' + (error && error.message ? error.message : error) +
    ' | ' + JSON.stringify(context));
}

// ========================================
// IDENTITY
// ========================================

function getActiveEmail_() {
  return (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
}

function isAuthorisedAdmin_(email) {
  const e = (email || '').toLowerCase().trim();
  return GLOBAL_CONFIG.adminEmails.some(a => a.toLowerCase() === e);
}

/**
 * Guard for every server endpoint. Throws rather than returning, so a caller
 * can never accidentally proceed on an unauthorised session.
 */
function requireAdmin_() {
  const email = getActiveEmail_();
  if (!isAuthorisedAdmin_(email)) {
    throw new Error('Not authorised. This utility is restricted to the MLC communications account.');
  }
  return email;
}

// ========================================
// DRIVE LOOKUPS (cached in Script Properties)
// ========================================

function props_() {
  return PropertiesService.getScriptProperties();
}

function getRootFolder_() {
  return DriveApp.getFolderById(GLOBAL_CONFIG.rootFolderId);
}

/**
 * Find a subfolder of the root by name, creating it if absent. Matching is
 * case-insensitive.
 */
function getArchiveFolder_(folderName) {
  const cacheKey = PROP_KEYS.folderPrefix + folderName.toUpperCase();
  const cached = props_().getProperty(cacheKey);
  if (cached) {
    try { return DriveApp.getFolderById(cached); } catch (e) { props_().deleteProperty(cacheKey); }
  }

  const root = getRootFolder_();
  const wanted = normaliseFolderName_(folderName);
  const it = root.getFolders();
  while (it.hasNext()) {
    const folder = it.next();
    if (normaliseFolderName_(folder.getName()) === wanted) {
      props_().setProperty(cacheKey, folder.getId());
      return folder;
    }
  }

  const created = root.createFolder(folderName);
  props_().setProperty(cacheKey, created.getId());
  return created;
}

function normaliseFolderName_(name) {
  return String(name).trim().toLowerCase().replace(/s$/, '');
}

/**
 * The live file for a mode — the exact file the website and every other
 * resource embeds.
 *
 * This is ALWAYS the file ID pinned in Config. It is deliberately not resolved
 * by filename: the whole point of the utility is that this one file persists
 * and receives new versions, so guessing at it by name would risk publishing
 * into the wrong file and leaving the real embed stale. If the configured file
 * cannot be opened we fail loudly rather than quietly creating a replacement.
 */
function getLiveFile_(modeKey) {
  const mode = MODES[modeKey];
  if (!mode) throw new Error('Unknown mode: ' + modeKey);

  if (!mode.liveFileId) {
    // Only ever true if someone blanks the config; publishing then creates the
    // file once and pins it, so subsequent publishes version that same file.
    const cached = props_().getProperty(PROP_KEYS.liveFilePrefix + modeKey);
    if (!cached) return null;
    try { return DriveApp.getFileById(cached); } catch (e) { return null; }
  }

  try {
    const file = DriveApp.getFileById(mode.liveFileId);
    if (file.isTrashed()) {
      throw new Error('The live ' + mode.label.toLowerCase() + ' file is in Drive\'s bin. ' +
        'Restore it from the bin — do not create a new one, or every embed will break.');
    }
    return file;
  } catch (e) {
    if (/bin/.test(e.message)) throw e;
    throw new Error('Cannot open the live ' + mode.label.toLowerCase() + ' file (' + mode.liveFileId + '). ' +
      'Check that ' + getActiveEmail_() + ' has edit access to it. Original error: ' + e.message);
  }
}

/**
 * Non-throwing variant, for status screens that must still render when the
 * live file is misconfigured or inaccessible.
 * @return {{file: (File|null), error: string}}
 */
function tryGetLiveFile_(modeKey) {
  try {
    return { file: getLiveFile_(modeKey), error: '' };
  } catch (e) {
    return { file: null, error: e.message };
  }
}

/**
 * URL for the church logo.
 *
 * Uses the /thumbnail endpoint with an explicit size — lh3.googleusercontent
 * URLs proved unreliable during the sibling project. sz=w512 also means we
 * serve a scaled copy rather than the full-size source PNG.
 *
 * Google will only serve it for a file readable without a session, so the
 * sharing is asserted once rather than assumed.
 */
function getLogoUrl_() {
  const id = GLOBAL_CONFIG.logoFileId || resolveLogoIdByName_();
  if (!id) return '';

  // Share it once, then remember that we have.
  if (props_().getProperty('MLC_LOGO_SHARED') !== id) {
    try {
      enforcePublicRead_(id);
      props_().setProperty('MLC_LOGO_SHARED', id);
    } catch (e) {
      logError_('getLogoUrl_ share', e, { id: id });
    }
  }

  return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w512';
}

function resolveLogoIdByName_() {
  const cached = props_().getProperty('MLC_LOGO_FILE_ID');
  if (cached) return cached;
  try {
    const it = getRootFolder_().getFilesByName('MLC Logo.png');
    if (it.hasNext()) {
      const id = it.next().getId();
      props_().setProperty('MLC_LOGO_FILE_ID', id);
      return id;
    }
  } catch (e) {
    logError_('resolveLogoIdByName_', e);
  }
  return '';
}

// ========================================
// FORMATTING
// ========================================

function formatTimestamp_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function humanFileSize_(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ========================================
// MONTH/YEAR PERIOD
//
// Newsletters are grouped by Month + Year, not a specific service date. An
// <input type="month"> yields "yyyy-MM"; normalised here to "yyyy-MM-01" so
// every function that does exact-string date comparisons, sorting, or
// parseIsoDate_() works unchanged — it is still a yyyy-MM-dd string
// underneath, just always the first of the month.
// ========================================

function normaliseMonthToIso_(yyyyMM) {
  if (typeof yyyyMM !== 'string' || !/^\d{4}-\d{2}$/.test(yyyyMM.trim())) return '';
  return yyyyMM.trim() + '-01';
}

function parseIsoDate_(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return null;
  return d;
}

function toIsoDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** "August 2026" — no day, unlike the sibling project's full spelled-out date. */
function formatMonthYear_(iso) {
  const d = parseIsoDate_(iso);
  if (!d) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMMM yyyy');
}

/** "August2026" — for filenames: month name + year, no day. */
function toFileMonthYear_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMMM yyyy');
}
