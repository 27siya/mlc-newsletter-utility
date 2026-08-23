/**
 * @fileoverview Drive mechanics: format conversion, in-place revisioning,
 * archiving and public-sharing enforcement.
 *
 * The central guarantee of this module: the live Newsletter file keeps the
 * SAME Drive file ID for ever. Every embed on the website and anywhere else
 * keeps working, because we push new revisions into the existing file rather
 * than replacing it. That requires the advanced Drive service — DriveApp
 * alone cannot add a binary revision.
 * @version 1.0.0
 */

/**
 * Ensure a file is readable and downloadable by the public, but not editable.
 * Re-asserted on every publish so a manual change in Drive can't silently
 * break the congregation's access.
 */
function enforcePublicRead_(fileId) {
  try {
    Drive.Permissions.create(
      { type: 'anyone', role: 'reader' },
      fileId,
      { supportsAllDrives: true, sendNotificationEmail: false }
    );
  } catch (e) {
    // Already shared with anyone — that is the desired end state, so carry on.
    if (!/already|duplicate/i.test(e.message || '')) logError_('enforcePublicRead_', e, { fileId });
  }

  try {
    // Downloading, printing and copying stay ON — the congregation must be able
    // to save the newsletter. Editing is withheld by the reader role above.
    Drive.Files.update(
      { copyRequiresWriterPermission: false, writersCanShare: true },
      fileId,
      null,
      { supportsAllDrives: true }
    );
  } catch (e) {
    logError_('enforcePublicRead_ flags', e, { fileId });
  }
}

/**
 * Normalise any accepted upload into a PDF blob.
 *
 * A Drive file's type cannot change between revisions, so the live file must
 * always be a PDF. A DOCX is converted here; the untouched original is kept
 * alongside it in the archive by the caller.
 *
 * @return {{pdf: Blob, converted: boolean}}
 */
function toPdfBlob_(blob, displayName) {
  const mime = blob.getContentType();

  if (mime === ACCEPTED_MIME.PDF) {
    return { pdf: blob.setName(displayName + '.pdf'), converted: false };
  }

  if (mime === ACCEPTED_MIME.DOCX || mime === ACCEPTED_MIME.DOC) {
    let tempDocId = null;
    try {
      // Uploading with a Google Docs MIME type performs the conversion.
      const temp = Drive.Files.create(
        { name: '[temp conversion] ' + displayName, mimeType: ACCEPTED_MIME.GDOC },
        blob,
        { supportsAllDrives: true, fields: 'id' }
      );
      tempDocId = temp.id;
      const pdf = DriveApp.getFileById(tempDocId).getAs(ACCEPTED_MIME.PDF).setName(displayName + '.pdf');
      // Force the bytes to materialise before the temp doc is removed.
      pdf.getBytes();
      return { pdf: pdf, converted: true };
    } finally {
      if (tempDocId) {
        try { Drive.Files.update({ trashed: true }, tempDocId, null, { supportsAllDrives: true }); }
        catch (e) { logError_('toPdfBlob_ cleanup', e, { tempDocId }); }
      }
    }
  }

  throw new Error('Unsupported file type: ' + mime + '. Upload a PDF or a Word document.');
}

/**
 * Push a new revision into the live file, keeping its ID.
 * @return {string} the file ID (unchanged)
 */
function pushRevision_(fileId, pdfBlob, revisionLabel) {
  Drive.Files.update(
    {},
    fileId,
    pdfBlob,
    { supportsAllDrives: true, keepRevisionForever: true, fields: 'id,version,modifiedTime' }
  );

  // Name the revision so Drive's own version history is readable by a human
  // who opens it outside this utility.
  try {
    const latest = getLatestRevisionId_(fileId);
    if (latest) {
      Drive.Revisions.update(
        { keepForever: true, publishedOutsideDomain: false },
        fileId,
        latest
      );
    }
  } catch (e) {
    // Revision naming is a nicety; never fail a publish over it.
    logError_('pushRevision_ label', e, { fileId, revisionLabel });
  }

  enforcePublicRead_(fileId);
  return fileId;
}

/**
 * Push the fixed placeholder into the live file — mechanically identical to
 * pushRevision_. Kept as a separate function because the label in the log
 * should never claim this is "a version of a document": the placeholder gets
 * no index record at all, so it is structurally absent from Document History
 * (see getDocumentHistory) without needing to filter Drive's revision list.
 */
function pushPlaceholderRevision_(fileId, pdfBlob, modeKey) {
  Drive.Files.update(
    {},
    fileId,
    pdfBlob,
    { supportsAllDrives: true, keepRevisionForever: true, fields: 'id,version,modifiedTime' }
  );

  try {
    const latest = getLatestRevisionId_(fileId);
    if (latest) Drive.Revisions.update({ keepForever: true, publishedOutsideDomain: false }, fileId, latest);
  } catch (e) {
    logError_('pushPlaceholderRevision_', e, { fileId, modeKey });
  }

  enforcePublicRead_(fileId);
  return fileId;
}

function getLatestRevisionId_(fileId) {
  const revisions = Drive.Revisions.list(fileId, { fields: 'revisions(id)' });
  const list = (revisions && revisions.revisions) || [];
  return list.length ? list[list.length - 1].id : null;
}

/**
 * Rename the live file to match the document now inside it.
 *
 * Safe, and worth doing: a Drive file's ID is independent of its name, so every
 * embed keeps working, while anyone who downloads the newsletter from the
 * website gets a file called "MLC Newsletter - August 2026.pdf" rather than a
 * generic "Newsletter.pdf". This only became safe once the live file was
 * pinned by ID instead of looked up by name.
 */
function renameLiveFile_(fileId, newName) {
  const name = sanitizeFileName(newName);
  if (!name) return;
  try {
    Drive.Files.update({ name: name + '.pdf' }, fileId, null, { supportsAllDrives: true });
  } catch (e) {
    // Never fail a publish over a rename — the document itself is already in.
    logError_('renameLiveFile_', e, { fileId, newName });
  }
}

/**
 * Create the live file for a mode when it does not yet exist.
 */
function createLiveFile_(modeKey, pdfBlob) {
  const mode = MODES[modeKey];
  const created = Drive.Files.create(
    { name: mode.liveFileName, parents: [GLOBAL_CONFIG.rootFolderId], mimeType: ACCEPTED_MIME.PDF },
    pdfBlob,
    { supportsAllDrives: true, fields: 'id' }
  );
  props_().setProperty(PROP_KEYS.liveFilePrefix + modeKey, created.id);
  enforcePublicRead_(created.id);
  return created.id;
}

/**
 * Copy the currently-live file into the archive under a given name, before it
 * is overwritten. Returns null when there is nothing live yet.
 */
function archiveCurrentLive_(modeKey, archiveFolder, archiveName) {
  const live = tryGetLiveFile_(modeKey).file;
  if (!live) return null;

  try {
    if (live.getSize() === 0) return null; // Placeholder file, nothing worth keeping.
  } catch (e) { /* size unavailable — archive anyway */ }

  const copy = live.makeCopy(sanitizeFileName(archiveName) + '.pdf', archiveFolder);
  enforcePublicRead_(copy.getId());
  return copy.getId();
}

/**
 * Store an original upload (typically the DOCX) beside its PDF in the archive,
 * so the editable source is never lost.
 */
function archiveOriginal_(blob, archiveFolder, baseName) {
  const extension = extensionForMime_(blob.getContentType());
  const file = archiveFolder.createFile(blob.setName(sanitizeFileName(baseName) + extension));
  enforcePublicRead_(file.getId());
  return file.getId();
}

function extensionForMime_(mime) {
  if (mime === ACCEPTED_MIME.DOCX) return '.docx';
  if (mime === ACCEPTED_MIME.DOC) return '.doc';
  return '.pdf';
}

/** Save a PDF into the archive folder as a standalone, permanent copy. */
function archivePdf_(pdfBlob, archiveFolder, baseName) {
  const file = archiveFolder.createFile(pdfBlob.copyBlob().setName(sanitizeFileName(baseName) + '.pdf'));
  enforcePublicRead_(file.getId());
  return file.getId();
}

/**
 * The fixed "document to be published" file for a mode — one per mode,
 * living permanently in the root folder. Disable Live pushes ITS content into
 * the live file (same live file ID; the embed never changes), rather than
 * generating a page fresh on every disable. Auto-created once if missing, so
 * there is nothing to configure by hand, and an admin can replace either file
 * in Drive at any time to redesign it.
 */
function getPlaceholderFile_(modeKey) {
  const mode = MODES[modeKey];
  const configuredId = mode.placeholderFileId;
  const propKey = 'MLC_PLACEHOLDER_FILE_' + modeKey;

  const tryId = configuredId || props_().getProperty(propKey);
  if (tryId) {
    try {
      const file = DriveApp.getFileById(tryId);
      if (!file.isTrashed()) return file;
    } catch (e) { /* fall through and recreate */ }
  }

  const pdf = makePlaceholderPdf_('DOCUMENT TO BE PUBLISHED', 'Midrand Lutheran Church — ' + mode.label);
  const name = 'MLC ' + mode.label + ' Placeholder (Document To Be Published)';
  const created = getRootFolder_().createFile(pdf.setName(name + '.pdf'));
  enforcePublicRead_(created.getId());
  props_().setProperty(propKey, created.getId());
  return created;
}

/**
 * Build the "nothing published yet" placeholder as a PDF.
 *
 * MLC pastel-red ground, church heading face, one line of text. Only ever
 * called to create the fixed placeholder file above the first time it's
 * needed — not on every Disable Live — so an untested rendering quirk here
 * is a one-time setup risk rather than something on the hot path of every
 * disable.
 *
 * @param {string} heading the line to display, e.g. "DOCUMENT TO BE PUBLISHED"
 * @param {string} subheading smaller line beneath it
 */
function makePlaceholderPdf_(heading, subheading) {
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>' +
    '@import url("https://fonts.googleapis.com/css2?family=Abril+Fatface&display=swap");' +
    '@page { size: A4 portrait; margin: 0; }' +
    'html, body { margin: 0; padding: 0; height: 100%; }' +
    // The converter needs to be told to keep background colours.
    'body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
    '.sheet { width: 100%; height: 1120px; background-color: #E8828E;' +
    '  display: flex; flex-direction: column; align-items: center; justify-content: center;' +
    '  text-align: center; box-sizing: border-box; padding: 60px; }' +
    '.heading { font-family: "Abril Fatface", Georgia, "Times New Roman", serif;' +
    '  font-size: 54px; line-height: 1.22; color: #FFFFFF; margin: 0 0 26px 0;' +
    '  text-shadow: 0 2px 6px rgba(28,36,48,0.25); }' +
    '.sub { font-family: Georgia, "Times New Roman", serif; font-size: 22px;' +
    '  color: #2C3E50; margin: 0; letter-spacing: 0.04em; }' +
    '.rule { width: 140px; height: 4px; background: #FFC561; margin: 34px auto 0 auto; }' +
    '</style></head><body>' +
    '<div class="sheet">' +
      '<p class="heading">' + escapeHtml(heading) + '</p>' +
      (subheading ? '<p class="sub">' + escapeHtml(subheading) + '</p>' : '') +
      '<div class="rule"></div>' +
    '</div></body></html>';

  return Utilities.newBlob(html, 'text/html', 'placeholder.html')
    .getAs(ACCEPTED_MIME.PDF)
    .setName('placeholder.pdf');
}

/**
 * Public-facing links for a file. previewUrl is what goes into a website embed.
 */
function fileLinks_(fileId) {
  return {
    id: fileId,
    viewUrl: 'https://drive.google.com/file/d/' + fileId + '/view',
    previewUrl: 'https://drive.google.com/file/d/' + fileId + '/preview',
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + fileId
  };
}
