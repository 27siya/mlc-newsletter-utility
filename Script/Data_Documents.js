/**
 * @fileoverview Publishing logic and the publication index.
 *
 * The index spreadsheet — not the filename — is the source of truth for which
 * document belongs to which issue period (Month + Year). Admins name files
 * however they like; the binding is made explicitly in the app, either at
 * publish time or by assigning a period to a file that is already sitting in
 * the archive.
 * @version 1.0.0
 */

const INDEX_HEADERS = [
  'Record ID', 'Mode', 'Issue Date', 'Issue Name',
  'Archive File ID', 'Archive File Name', 'Original File ID',
  'Published At', 'Published By', 'Status', 'Notes'
];

const LOG_HEADERS = ['Timestamp', 'User', 'Action', 'Mode', 'Issue Date', 'Detail'];

// ========================================
// INDEX SPREADSHEET
// ========================================

/**
 * The index lives in the root Drive folder and is created on first run, so
 * there is no ID to configure by hand.
 */
function getIndexSpreadsheet_() {
  const cached = props_().getProperty(PROP_KEYS.indexSheetId);
  if (cached) {
    try { return SpreadsheetApp.openById(cached); }
    catch (e) { props_().deleteProperty(PROP_KEYS.indexSheetId); }
  }

  const root = getRootFolder_();
  const existing = root.getFilesByName(INDEX_SHEET_NAME);
  if (existing.hasNext()) {
    const ss = SpreadsheetApp.openById(existing.next().getId());
    props_().setProperty(PROP_KEYS.indexSheetId, ss.getId());
    ensureTabs_(ss);
    return ss;
  }

  const ss = SpreadsheetApp.create(INDEX_SHEET_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(root);
  ensureTabs_(ss);
  props_().setProperty(PROP_KEYS.indexSheetId, ss.getId());
  return ss;
}

function ensureTabs_(ss) {
  ensureTab_(ss, INDEX_TAB, INDEX_HEADERS);
  ensureTab_(ss, LOG_TAB, LOG_HEADERS);
  const first = ss.getSheets()[0];
  if (first.getName() === 'Sheet1' && ss.getSheets().length > 1) ss.deleteSheet(first);
}

function ensureTab_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#5A1A1F').setFontColor('#FFC561');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getIndexTab_() {
  return ensureTab_(getIndexSpreadsheet_(), INDEX_TAB, INDEX_HEADERS);
}

/** Every publication record, newest first. */
function readIndex_() {
  const sheet = getIndexTab_();
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, INDEX_HEADERS.length).getValues();
  return values.map((row, i) => ({
    rowNumber: i + 2,
    recordId: String(row[0]),
    mode: String(row[1]),
    issueDate: normaliseCellDate_(row[2]),
    issueName: String(row[3] || ''),
    archiveFileId: String(row[4] || ''),
    archiveFileName: String(row[5] || ''),
    originalFileId: String(row[6] || ''),
    publishedAt: row[7] instanceof Date ? formatTimestamp_(row[7]) : String(row[7] || ''),
    publishedBy: String(row[8] || ''),
    status: String(row[9] || 'ACTIVE').toUpperCase(),
    notes: String(row[10] || '')
  })).filter(r => r.recordId);
}

/** Sheets may hand back a Date or a string depending on how a cell was written. */
function normaliseCellDate_(value) {
  if (!value) return '';
  if (value instanceof Date) return toIsoDate_(value);
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s;
}

function appendRecord_(record) {
  const sheet = getIndexTab_();
  sheet.appendRow([
    record.recordId, record.mode, record.issueDate,
    record.issueName, record.archiveFileId, record.archiveFileName,
    record.originalFileId || '', new Date(), record.publishedBy, record.status || 'ACTIVE',
    record.notes || ''
  ]);
  return record;
}

function updateRecordFields_(rowNumber, fields) {
  const sheet = getIndexTab_();
  const columnFor = {
    issueDate: 3, issueName: 4,
    archiveFileName: 6, status: 10, notes: 11
  };
  Object.keys(fields).forEach(key => {
    if (!columnFor[key]) return;
    sheet.getRange(rowNumber, columnFor[key]).setValue(fields[key]);
  });
}

function logActivity_(action, mode, issueDate, detail) {
  try {
    const sheet = ensureTab_(getIndexSpreadsheet_(), LOG_TAB, LOG_HEADERS);
    sheet.appendRow([new Date(), getActiveEmail_(), action, mode || '', issueDate || '', detail || '']);
  } catch (e) {
    logError_('logActivity_', e, { action: action });
  }
}

function newRecordId_() {
  return 'MLC-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') +
    '-' + Math.floor(Math.random() * 1000);
}

// ========================================
// NAMING (a suggestion only — always editable)
// ========================================

/**
 * Build the filename we propose for the archive copy. The admin can replace it
 * entirely; nothing in the system reads meaning back out of a filename.
 * "MLC Newsletter - August 2026.pdf" — month name + year, no day.
 */
function buildSuggestedName(modeKey, isoDate) {
  const mode = MODES[modeKey];
  if (!mode) return '';
  const start = parseIsoDate_(isoDate);
  if (!start) return '';

  const name = mode.namePrefix + ' - ' + toFileMonthYear_(start);
  return sanitizeFileName(name);
}

// ========================================
// STATUS
// ========================================

/**
 * What is live right now, per mode, plus the record it is bound to.
 */
function getLiveStatus() {
  requireAdmin_();
  const index = readIndex_();
  const status = {};

  Object.keys(MODES).forEach(modeKey => {
    const attempt = tryGetLiveFile_(modeKey);
    const live = attempt.file;
    const record = index
      .filter(r => r.mode === modeKey && r.status === 'LIVE')
      .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1))[0] || null;

    status[modeKey] = {
      mode: modeKey,
      label: MODES[modeKey].label,
      exists: !!live,
      error: attempt.error,
      fileId: MODES[modeKey].liveFileId || (live ? live.getId() : ''),
      fileName: live ? live.getName() : MODES[modeKey].liveFileName,
      links: live ? fileLinks_(live.getId()) : null,
      lastUpdated: live ? formatTimestamp_(live.getLastUpdated()) : '',
      size: live ? humanFileSize_(live.getSize()) : '',
      record: record,
      // The placeholder is a state the live file is in, not a document of its
      // own — it gets no record. What IS remembered is which real record was
      // live right before it, so the sidebar can offer one-click Re-enable.
      placeholderActive: isPlaceholderActive_(modeKey),
      disabledRecord: getDisabledRecordInfo_(modeKey)
    };
  });

  return createSuccess(status);
}

/**
 * Is something already published for this mode and issue period?
 * Called as the admin picks a month, so the warning appears before they upload.
 */
function checkExistingForDate(modeKey, isoDate) {
  requireAdmin_();
  const matches = readIndex_().filter(r =>
    r.mode === modeKey && r.issueDate === isoDate && r.status !== 'SUPERSEDED'
  );
  return createSuccess({
    exists: matches.length > 0,
    records: matches
  });
}

// ========================================
// PUBLISHING
// ========================================

/**
 * Publish a document for an issue period (Month + Year).
 *
 * @param {Object} payload
 * @param {string} payload.mode              NEWSLETTER
 * @param {string} payload.issueDate         yyyy-MM-dd (always the 1st of the month)
 * @param {string} payload.issueName         free text, whatever the admin wants (e.g. "Second Quarter Edition")
 * @param {string} payload.archiveName       filename for the archive copy
 * @param {string} payload.fileName          original upload filename
 * @param {string} payload.mimeType
 * @param {string} payload.dataBase64
 * @param {string} payload.notes
 * @param {boolean} payload.confirmReplace   proceed despite an existing record
 * @param {boolean} payload.forceLive        publish live even if a later period is live
 */
function publishDocument(payload) {
  const email = requireAdmin_();

  try {
    const mode = MODES[payload && payload.mode];
    if (!mode) return createError('Unknown document type.', 'BAD_MODE');

    const issueDate = parseIsoDate_(payload.issueDate);
    if (!issueDate) return createError('Pick the month and year this issue is for.', 'BAD_DATE');

    if (!payload.dataBase64) return createError('No file was received. Please choose a file.', 'NO_FILE');

    const bytes = Utilities.base64Decode(payload.dataBase64);
    if (bytes.length > GLOBAL_CONFIG.maxUploadBytes) {
      return createError('That file is larger than ' + humanFileSize_(GLOBAL_CONFIG.maxUploadBytes) +
        '. Compress it in Canva (or Acrobat/an online PDF compressor) before uploading — a file this large ' +
        'fails to display properly in the website embed.', 'TOO_BIG');
    }

    const index = readIndex_();

    // Guard against an accidental second upload for the same issue period.
    const clashes = index.filter(r =>
      r.mode === payload.mode && r.issueDate === payload.issueDate && r.status !== 'SUPERSEDED'
    );
    if (clashes.length && !payload.confirmReplace) {
      return createSuccess({ needsConfirmation: true, existing: clashes },
        'A document is already published for this issue.');
    }

    const blob = Utilities.newBlob(bytes, payload.mimeType || ACCEPTED_MIME.PDF,
      sanitizeFileName(payload.fileName || 'upload'));

    const archiveName = sanitizeFileName(
      payload.archiveName || buildSuggestedName(payload.mode, payload.issueDate)
    );

    const archiveFolder = getArchiveFolder_(mode.archiveFolderName);

    // Anything currently live that this utility has never recorded is preserved
    // before it is overwritten. It lands in the archive undated, for the admin
    // to assign an issue period to from the Archive tab.
    preserveUnrecordedLive_(payload.mode, index, archiveFolder);

    const converted = toPdfBlob_(blob, archiveName);

    // Archive first: the permanent, per-issue copy.
    const archiveFileId = archivePdf_(converted.pdf, archiveFolder, archiveName);
    let originalFileId = '';
    if (converted.converted) {
      originalFileId = archiveOriginal_(blob, archiveFolder, archiveName + ' (source)');
    }

    // Should this become the live file? Only if it is not older than what is
    // already live, unless the admin explicitly overrides.
    const currentLive = index
      .filter(r => r.mode === payload.mode && r.status === 'LIVE')
      .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1))[0];

    // archiveOnly is the admin explicitly choosing "Upload Only": file it, do
    // not touch what the congregation is currently reading.
    const isNewer = !currentLive || payload.issueDate >= currentLive.issueDate;
    const goLive = payload.archiveOnly === true
      ? false
      : (isNewer || payload.forceLive === true);

    let liveFileId = '';
    if (goLive) {
      const live = getLiveFile_(payload.mode);
      liveFileId = live
        ? pushRevision_(live.getId(), converted.pdf, archiveName)
        : createLiveFile_(payload.mode, converted.pdf);

      // The live file carries the document's own name, so downloads from the
      // website are meaningfully titled. Its ID — and every embed — is unchanged.
      renameLiveFile_(liveFileId, archiveName);

      // Demote whatever was live before.
      index.filter(r => r.mode === payload.mode && r.status === 'LIVE')
        .forEach(r => updateRecordFields_(r.rowNumber, { status: 'ARCHIVED' }));
    }

    // Supersede any earlier record for this same issue period.
    clashes.forEach(r => updateRecordFields_(r.rowNumber, { status: 'SUPERSEDED' }));

    const record = appendRecord_({
      recordId: newRecordId_(),
      mode: payload.mode,
      issueDate: payload.issueDate,
      issueName: sanitizeInput(payload.issueName),
      archiveFileId: archiveFileId,
      archiveFileName: archiveName,
      originalFileId: originalFileId,
      publishedBy: email,
      status: goLive ? 'LIVE' : 'ARCHIVED',
      notes: sanitizeInput(payload.notes, 500)
    });

    logActivity_(goLive ? 'PUBLISH_LIVE' : 'ARCHIVE_ONLY', payload.mode, payload.issueDate,
      archiveName + (converted.converted ? ' (converted from Word)' : ''));

    return createSuccess({
      needsConfirmation: false,
      record: record,
      wentLive: goLive,
      converted: converted.converted,
      supersededCount: clashes.length,
      // Only offer the "publish it anyway" prompt when going live was wanted
      // but declined on age grounds — never when Upload Only was chosen.
      blockedByNewer: (!goLive && payload.archiveOnly !== true && !!currentLive) ? currentLive : null,
      links: liveFileId ? fileLinks_(liveFileId) : fileLinks_(archiveFileId)
    }, goLive
      ? 'Published. The live newsletter has been updated.'
      : (payload.archiveOnly === true
          ? 'Uploaded to the archive. The live newsletter is unchanged.'
          : 'Archived. The live file was left alone because a later issue is currently published.'));

  } catch (e) {
    logError_('publishDocument', e, { mode: payload && payload.mode });
    return createError(e.message, 'PUBLISH_FAILED');
  }
}

/**
 * If the live file holds a document this utility never recorded — the state on
 * day one, or after someone edited Drive by hand — copy it into the archive so
 * it is not lost when we push a new revision over it.
 */
function preserveUnrecordedLive_(modeKey, index, archiveFolder) {
  const hasLiveRecord = index.some(r => r.mode === modeKey && r.status === 'LIVE');
  if (hasLiveRecord) return null;

  const live = tryGetLiveFile_(modeKey).file;
  if (!live) return null;

  try {
    if (live.getSize() === 0) return null;
    const stamp = Utilities.formatDate(live.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const name = sanitizeFileName(MODES[modeKey].label + ' (previously live, ' + stamp + ')');
    const copy = live.makeCopy(name + '.pdf', archiveFolder);
    enforcePublicRead_(copy.getId());
    logActivity_('PRESERVE_UNRECORDED', modeKey, '', name);
    return copy.getId();
  } catch (e) {
    logError_('preserveUnrecordedLive_', e, { modeKey });
    return null;
  }
}

// ========================================
// ARCHIVE
// ========================================

/**
 * Everything the archive knows about, indexed or not.
 *
 * Indexed records carry an issue period. Files sitting in the archive folder
 * that were never published through this utility are returned as "unassigned"
 * so the admin can give them a period and pull them into the system.
 */
function listArchive(filters) {
  requireAdmin_();
  const f = filters || {};

  try {
    let records = readIndex_();
    if (f.mode) records = records.filter(r => r.mode === f.mode);
    if (f.fromDate) records = records.filter(r => r.issueDate >= f.fromDate);
    if (f.toDate) records = records.filter(r => r.issueDate <= f.toDate);
    if (f.includeSuperseded !== true) records = records.filter(r => r.status !== 'SUPERSEDED');

    if (f.query) {
      const q = String(f.query).toLowerCase();
      records = records.filter(r =>
        (r.issueName + ' ' + r.archiveFileName + ' ' + r.notes).toLowerCase().indexOf(q) !== -1);
    }

    records.sort((a, b) => (a.issueDate < b.issueDate ? 1 : a.issueDate > b.issueDate ? -1 : 0));

    const enriched = records.map(r => Object.assign({}, r, {
      links: r.archiveFileId ? fileLinks_(r.archiveFileId) : null,
      originalLinks: r.originalFileId ? fileLinks_(r.originalFileId) : null,
      displayDate: r.issueDate ? formatMonthYear_(r.issueDate) : ''
    }));

    return createSuccess({
      records: enriched,
      unassigned: f.includeUnassigned === false ? [] : listUnassignedFiles_(f.mode)
    });
  } catch (e) {
    logError_('listArchive', e, f);
    return createError(e.message, 'ARCHIVE_FAILED');
  }
}

/**
 * Files present in the archive folder with no index record. These are the
 * documents someone filed by hand — the admin dates them from the UI.
 */
function listUnassignedFiles_(modeKey) {
  const known = {};
  readIndex_().forEach(r => {
    if (r.archiveFileId) known[r.archiveFileId] = true;
    if (r.originalFileId) known[r.originalFileId] = true;
  });

  const out = [];
  Object.keys(MODES).forEach(key => {
    if (modeKey && key !== modeKey) return;
    let folder;
    try { folder = getArchiveFolder_(MODES[key].archiveFolderName); } catch (e) { return; }
    const it = folder.getFiles();
    while (it.hasNext() && out.length < 300) {
      const file = it.next();
      if (known[file.getId()] || file.isTrashed()) continue;
      out.push({
        fileId: file.getId(),
        fileName: file.getName(),
        mode: key,
        folder: folder.getName(),
        updated: formatTimestamp_(file.getLastUpdated()),
        size: humanFileSize_(file.getSize()),
        links: fileLinks_(file.getId())
      });
    }
  });

  out.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  return out;
}

/**
 * Bind an existing archive file to an issue period — the manual counterpart to
 * publishing, for documents that were filed outside this utility.
 */
function assignFileToDate(payload) {
  const email = requireAdmin_();

  try {
    const mode = MODES[payload && payload.mode];
    if (!mode) return createError('Unknown document type.', 'BAD_MODE');
    if (!parseIsoDate_(payload.issueDate)) return createError('Pick the month and year.', 'BAD_DATE');
    if (!payload.fileId) return createError('No file selected.', 'NO_FILE');

    const file = DriveApp.getFileById(payload.fileId);

    const clashes = readIndex_().filter(r =>
      r.mode === payload.mode && r.issueDate === payload.issueDate && r.status !== 'SUPERSEDED');
    if (clashes.length && !payload.confirmReplace) {
      return createSuccess({ needsConfirmation: true, existing: clashes },
        'A document is already recorded for this issue.');
    }
    clashes.forEach(r => updateRecordFields_(r.rowNumber, { status: 'SUPERSEDED' }));

    enforcePublicRead_(file.getId());

    const record = appendRecord_({
      recordId: newRecordId_(),
      mode: payload.mode,
      issueDate: payload.issueDate,
      issueName: sanitizeInput(payload.issueName),
      archiveFileId: file.getId(),
      archiveFileName: file.getName(),
      originalFileId: '',
      publishedBy: email,
      status: 'ARCHIVED',
      notes: sanitizeInput(payload.notes, 500)
    });

    // "Publish As Live" on an undated file: the period is captured first,
    // above, then the document goes live in the same action.
    let liveLinks = null;
    if (payload.makeLive === true) {
      const liveId = activateRecord_(record);
      liveLinks = fileLinks_(liveId);
      record.status = 'LIVE';
    }

    logActivity_(payload.makeLive === true ? 'ASSIGN_AND_PUBLISH' : 'ASSIGN_DATE',
      payload.mode, payload.issueDate, file.getName());

    return createSuccess({ record: record, links: liveLinks },
      payload.makeLive === true
        ? 'Dated and published. The live newsletter is now this document.'
        : 'Dated and added to the archive index.');
  } catch (e) {
    logError_('assignFileToDate', e);
    return createError(e.message, 'ASSIGN_FAILED');
  }
}

/** Correct the details on a record without touching the file itself. */
function updateRecord(payload) {
  requireAdmin_();
  try {
    const record = readIndex_().find(r => r.recordId === (payload && payload.recordId));
    if (!record) return createError('That record no longer exists.', 'NOT_FOUND');

    const fields = {};
    if (payload.issueDate && parseIsoDate_(payload.issueDate)) fields.issueDate = payload.issueDate;
    if (typeof payload.issueName === 'string') fields.issueName = sanitizeInput(payload.issueName);
    if (typeof payload.notes === 'string') fields.notes = sanitizeInput(payload.notes, 500);

    updateRecordFields_(record.rowNumber, fields);
    logActivity_('UPDATE_RECORD', record.mode, fields.issueDate || record.issueDate, record.archiveFileName);
    return createSuccess(null, 'Record updated.');
  } catch (e) {
    logError_('updateRecord', e);
    return createError(e.message, 'UPDATE_FAILED');
  }
}

/**
 * Make an indexed record the live document.
 *
 * Shared by "Set as Live" on a dated record and by publishing an undated file
 * straight from the archive. The source is converted if it is not already a
 * PDF — an archived Word document must not be pushed into a PDF live file.
 *
 * @return {string} the live file ID (unchanged, as always)
 */
function activateRecord_(record) {
  const source = DriveApp.getFileById(record.archiveFileId);
  const blob = source.getBlob();
  const name = record.archiveFileName || source.getName().replace(/\.[^.]+$/, '');

  const pdf = blob.getContentType() === ACCEPTED_MIME.PDF
    ? blob.setName(name + '.pdf')
    : toPdfBlob_(blob, name).pdf;

  const live = getLiveFile_(record.mode);
  const liveId = live
    ? pushRevision_(live.getId(), pdf, name)
    : createLiveFile_(record.mode, pdf);

  renameLiveFile_(liveId, name);

  // Demote whatever was live before, then promote this one.
  readIndex_()
    .filter(r => r.mode === record.mode && r.status === 'LIVE' && r.recordId !== record.recordId)
    .forEach(r => updateRecordFields_(r.rowNumber, { status: 'ARCHIVED' }));
  updateRecordFields_(record.rowNumber, { status: 'LIVE' });

  // A real document is live again — the placeholder state, if any, is over.
  clearPlaceholderActive_(record.mode);

  return liveId;
}

function restoreToLive(recordId) {
  requireAdmin_();

  try {
    const record = readIndex_().find(r => r.recordId === recordId);
    if (!record) return createError('That record no longer exists.', 'NOT_FOUND');
    if (!record.archiveFileId) return createError('That record has no archived file to restore.', 'NO_FILE');

    const liveId = activateRecord_(record);

    logActivity_('RESTORE_LIVE', record.mode, record.issueDate, record.archiveFileName);
    return createSuccess({ links: fileLinks_(liveId) },
      'Done. The live newsletter is now this document.');
  } catch (e) {
    logError_('restoreToLive', e, { recordId });
    return createError(e.message, 'RESTORE_FAILED');
  }
}

// ========================================
// REMOVAL
//
// Two distinct operations, deliberately kept apart:
//   unassignRecord  — forgets the period binding; the file stays in Drive.
//   trashDocument   — sends the file to Drive's trash as well.
//
// Nothing here deletes permanently. Trashed files sit in Drive's bin and can be
// restored from there; emptying the bin is a decision for a human, in Drive.
// ========================================

function deleteIndexRow_(rowNumber) {
  getIndexTab_().deleteRow(rowNumber);
}

/**
 * Detach a document from its issue period. The file is untouched and returns
 * to the "files without a service date" list, ready to be re-dated.
 */
function unassignRecord(recordId) {
  requireAdmin_();

  try {
    const record = readIndex_().find(r => r.recordId === recordId);
    if (!record) return createError('That record no longer exists.', 'NOT_FOUND');

    if (record.status === 'LIVE') {
      return createError(
        'This is the active document. Make another document active first, then remove its date.',
        'IS_LIVE');
    }

    deleteIndexRow_(record.rowNumber);
    logActivity_('UNASSIGN_DATE', record.mode, record.issueDate, record.archiveFileName);

    return createSuccess({ fileName: record.archiveFileName },
      'Date removed. The file is still in the archive folder, now undated.');
  } catch (e) {
    logError_('unassignRecord', e, { recordId });
    return createError(e.message, 'UNASSIGN_FAILED');
  }
}

/**
 * Send a document to Drive's trash and drop its index record.
 *
 * @param {Object} payload
 * @param {string} payload.recordId       an indexed record, or...
 * @param {string} payload.fileId         ...a loose file with no record
 * @param {boolean} payload.confirmLive   required to trash the active document
 */
function trashDocument(payload) {
  requireAdmin_();

  try {
    const p = payload || {};
    let record = null;
    let fileId = p.fileId;

    if (p.recordId) {
      record = readIndex_().find(r => r.recordId === p.recordId);
      if (!record) return createError('That record no longer exists.', 'NOT_FOUND');
      fileId = record.archiveFileId;

      if (record.status === 'LIVE' && p.confirmLive !== true) {
        return createSuccess({ needsLiveConfirmation: true, record: record },
          'This is the active document.');
      }
    }

    if (!fileId) return createError('Nothing to remove.', 'NO_FILE');

    // Never let the live file itself be trashed — that would break every embed.
    Object.keys(MODES).forEach(key => {
      const live = tryGetLiveFile_(key).file;
      if (live && live.getId() === fileId) {
        throw new Error('That is the live newsletter file itself, which the website embeds point at. ' +
          'It cannot be removed — publish or activate a different document instead.');
      }
    });

    const trashed = [];
    const file = DriveApp.getFileById(fileId);
    const fileName = file.getName();
    file.setTrashed(true);
    trashed.push(fileName);

    // The Word original, where one was kept alongside the PDF.
    if (record && record.originalFileId) {
      try {
        const original = DriveApp.getFileById(record.originalFileId);
        trashed.push(original.getName());
        original.setTrashed(true);
      } catch (e) {
        logError_('trashDocument original', e, { id: record.originalFileId });
      }
    }

    if (record) deleteIndexRow_(record.rowNumber);

    logActivity_('TRASH', record ? record.mode : '', record ? record.issueDate : '', trashed.join(' + '));

    return createSuccess({ trashed: trashed },
      trashed.length > 1
        ? 'Moved to Drive\'s bin: ' + trashed.length + ' files. They can be restored from Drive for 30 days.'
        : 'Moved to Drive\'s bin. It can be restored from Drive for 30 days.');
  } catch (e) {
    logError_('trashDocument', e);
    return createError(e.message, 'TRASH_FAILED');
  }
}

// ========================================
// PLACEHOLDER STATE
//
// The placeholder is deliberately NOT a real document: it gets no index
// record, is never dated, is never archived, and its Drive revision is not
// shown as version history. It is a state the live file is in, not a
// document in its own right. What IS remembered is which real record was
// live immediately before disabling, so re-enabling is one click.
// ========================================

function isPlaceholderActive_(modeKey) {
  return props_().getProperty(PROP_KEYS.placeholderActivePrefix + modeKey) === 'true';
}

function setPlaceholderActive_(modeKey, recordId) {
  props_().setProperty(PROP_KEYS.placeholderActivePrefix + modeKey, 'true');
  props_().setProperty(PROP_KEYS.disabledRecordPrefix + modeKey, recordId || '');
}

/** Cleared by anything that pushes a REAL document into the live file. */
function clearPlaceholderActive_(modeKey) {
  props_().deleteProperty(PROP_KEYS.placeholderActivePrefix + modeKey);
  props_().deleteProperty(PROP_KEYS.disabledRecordPrefix + modeKey);
}

/** The record that was live right before it was disabled, if it still exists. */
function getDisabledRecordInfo_(modeKey) {
  const recordId = props_().getProperty(PROP_KEYS.disabledRecordPrefix + modeKey);
  if (!recordId) return null;
  const record = readIndex_().find(r => r.recordId === recordId);
  if (!record) return null;
  return {
    recordId: record.recordId,
    issueName: record.issueName,
    issueDate: record.issueDate,
    archiveFileName: record.archiveFileName
  };
}

/**
 * Take the live document down without breaking anything.
 *
 * The live file keeps its ID and stays published — the fixed placeholder file
 * for this mode is versioned into it instead, so the website shows "document
 * to be published" rather than last month's newsletter. The record that was
 * live is remembered so re-enabling it is a single click, not a trip to the
 * Archive.
 */
function disableLive(modeKey) {
  requireAdmin_();

  try {
    const mode = MODES[modeKey];
    if (!mode) return createError('Unknown document type.', 'BAD_MODE');

    const live = getLiveFile_(modeKey);
    if (!live) return createError('There is no live ' + mode.label.toLowerCase() + ' file to disable.', 'NO_FILE');

    if (isPlaceholderActive_(modeKey)) {
      return createError('The live ' + mode.label.toLowerCase() + ' is already disabled.', 'ALREADY_DISABLED');
    }

    const wasLive = readIndex_().find(r => r.mode === modeKey && r.status === 'LIVE');

    const placeholder = getPlaceholderFile_(modeKey);
    pushPlaceholderRevision_(live.getId(), placeholder.getBlob(), modeKey);
    renameLiveFile_(live.getId(), 'MLC ' + mode.label + ' - Document To Be Published');

    // Whatever was live stays a normal, restorable ARCHIVED record — this is
    // what "Set as Live" in the Archive already knows how to bring back. The
    // recordId is additionally remembered so Re-enable can do it in one click.
    if (wasLive) updateRecordFields_(wasLive.rowNumber, { status: 'ARCHIVED' });
    setPlaceholderActive_(modeKey, wasLive ? wasLive.recordId : '');

    logActivity_('DISABLE_LIVE', modeKey, '', 'Placeholder pushed to the live file');

    return createSuccess({ links: fileLinks_(live.getId()) },
      'The live ' + mode.label.toLowerCase() + ' now shows the placeholder. The link is unchanged.');
  } catch (e) {
    logError_('disableLive', e, { modeKey });
    return createError(e.message, 'DISABLE_FAILED');
  }
}

/**
 * Undo Disable Live in one step: restores whichever document was live
 * immediately before it was disabled.
 */
function reenableLive(modeKey) {
  requireAdmin_();

  try {
    const mode = MODES[modeKey];
    if (!mode) return createError('Unknown document type.', 'BAD_MODE');
    if (!isPlaceholderActive_(modeKey)) {
      return createError('The live ' + mode.label.toLowerCase() + ' is not currently disabled.', 'NOT_DISABLED');
    }

    const info = getDisabledRecordInfo_(modeKey);
    if (!info) {
      clearPlaceholderActive_(modeKey);
      return createError('The document that was live before disabling could no longer be found. ' +
        'Choose one from the Archive and use Set as Live instead.', 'RECORD_GONE');
    }

    const record = readIndex_().find(r => r.recordId === info.recordId);
    const liveId = activateRecord_(record);
    clearPlaceholderActive_(modeKey);

    logActivity_('REENABLE_LIVE', modeKey, record.issueDate, record.archiveFileName);
    return createSuccess({ links: fileLinks_(liveId) },
      'Re-enabled. The live newsletter is ' + (record.issueName || record.archiveFileName) + ' again.');
  } catch (e) {
    logError_('reenableLive', e, { modeKey });
    return createError(e.message, 'REENABLE_FAILED');
  }
}

/**
 * Bind the document currently sitting in the live file to an issue period.
 *
 * This is the day-one case: the live newsletter was published before this
 * utility existed, so nothing records which issue it belongs to. Dating it
 * takes a permanent copy into the archive and records it as the live
 * document — the live file itself is untouched, so the website sees nothing
 * change.
 */
function dateCurrentLive(payload) {
  const email = requireAdmin_();

  try {
    const p = payload || {};
    const mode = MODES[p.mode];
    if (!mode) return createError('Unknown document type.', 'BAD_MODE');
    if (!parseIsoDate_(p.issueDate)) return createError('Pick the month and year.', 'BAD_DATE');

    const live = getLiveFile_(p.mode);
    if (!live) return createError('There is no live ' + mode.label.toLowerCase() + ' file.', 'NO_FILE');

    // The placeholder is not a real document — it must never be dated,
    // archived or treated as content in its own right.
    if (isPlaceholderActive_(p.mode)) {
      return createError('The live ' + mode.label.toLowerCase() + ' is currently disabled and showing the ' +
        'placeholder. Re-enable it, or publish a new document, instead of dating this.', 'PLACEHOLDER_ACTIVE');
    }

    const clashes = readIndex_().filter(r =>
      r.mode === p.mode && r.issueDate === p.issueDate && r.status !== 'SUPERSEDED');
    if (clashes.length && p.confirmReplace !== true) {
      return createSuccess({ needsConfirmation: true, existing: clashes },
        'A document is already recorded for this issue.');
    }
    clashes.forEach(r => updateRecordFields_(r.rowNumber, { status: 'SUPERSEDED' }));

    const archiveName = sanitizeFileName(
      p.archiveName || buildSuggestedName(p.mode, p.issueDate));

    // Take the permanent archive copy of whatever is live right now.
    const copy = live.makeCopy(archiveName + '.pdf', getArchiveFolder_(mode.archiveFolderName));
    enforcePublicRead_(copy.getId());

    // Anything else marked live is superseded by this, the actual live document.
    readIndex_().filter(r => r.mode === p.mode && r.status === 'LIVE')
      .forEach(r => updateRecordFields_(r.rowNumber, { status: 'ARCHIVED' }));

    const record = appendRecord_({
      recordId: newRecordId_(),
      mode: p.mode,
      issueDate: p.issueDate,
      issueName: sanitizeInput(p.issueName),
      archiveFileId: copy.getId(),
      archiveFileName: archiveName,
      originalFileId: '',
      publishedBy: email,
      status: 'LIVE',
      notes: sanitizeInput(p.notes, 500)
    });

    // Now that we know what it is, name the live file accordingly.
    renameLiveFile_(live.getId(), archiveName);

    logActivity_('DATE_CURRENT_LIVE', p.mode, p.issueDate, archiveName);
    return createSuccess({ record: record },
      'Dated. The live newsletter is now recorded, and a copy is in the archive.');
  } catch (e) {
    logError_('dateCurrentLive', e);
    return createError(e.message, 'DATE_LIVE_FAILED');
  }
}

/**
 * The publishing history of ONE issue period — every draft, correction and
 * republish that has ever been filed for it — as opposed to Drive's raw
 * revision list on the live file, which mixes together whatever unrelated
 * periods happened to pass through that file over time. This is "versions"
 * in the sense an admin actually means: versions of the same issue.
 *
 * Scoped to the issue period of whichever document is currently live (or, if
 * the live file is disabled, the one that was live right before that).
 */
function getDocumentHistory(modeKey) {
  requireAdmin_();

  try {
    const mode = MODES[modeKey];
    if (!mode) return createError('Unknown document type.', 'BAD_MODE');

    const index = readIndex_();
    const liveRecord = index.find(r => r.mode === modeKey && r.status === 'LIVE');
    const disabled = getDisabledRecordInfo_(modeKey);
    const refDate = liveRecord ? liveRecord.issueDate : (disabled ? disabled.issueDate : '');

    if (!refDate) {
      return createSuccess({ issueDate: '', issueName: '', records: [] });
    }

    const records = index
      .filter(r => r.mode === modeKey && r.issueDate === refDate)
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
      .map(r => Object.assign({}, r, {
        links: r.archiveFileId ? fileLinks_(r.archiveFileId) : null,
        originalLinks: r.originalFileId ? fileLinks_(r.originalFileId) : null,
        displayDate: formatMonthYear_(r.issueDate)
      }));

    return createSuccess({
      issueDate: refDate,
      issueName: (records[0] && records[0].issueName) || '',
      records: records
    });
  } catch (e) {
    logError_('getDocumentHistory', e, { modeKey });
    return createError(e.message, 'HISTORY_FAILED');
  }
}

/** Suggested filename for the publish form, called as the month changes. */
function suggestForDate(modeKey, isoDate) {
  requireAdmin_();
  if (!parseIsoDate_(isoDate)) return createError('Invalid month.', 'BAD_DATE');
  return createSuccess({
    suggestedFileName: buildSuggestedName(modeKey, isoDate)
  });
}
