/**
 * @fileoverview Central configuration for the MLC Comms Newsletter Utility.
 * Publishes the church newsletter to Drive with in-place versioning, so the
 * public embed URL never changes.
 * @version 1.0.0
 */

// Build number — auto-bumped by deploy.ps1 on each deploy.
const PORTAL_BUILD = 4;

const GLOBAL_CONFIG = {
  // Root Drive folder holding the live file and the archive subfolder.
  rootFolderId: '1QmfoNJ2GGwDp_t_g_rH-dgdmplRCfC2C',

  // Only this account may run the utility.
  adminEmails: [
    'comms@midrandlutheranchurch.co.za'
  ],

  // Church logo — "MLC Comms Logo.png", owned by comms@ in its own Drive
  // folder. Blank falls back to a by-name lookup in this project's own root
  // folder.
  logoFileId: '1ZKCp-oEj033_5QHmthYMMZ4KZKJMPnP6',

  // Largest upload accepted from the browser. Kept low deliberately: a
  // Canva-exported newsletter PDF can run 50-100MB+ before compression, and
  // a file that large fails to display in the website's Drive embed and is
  // painfully slow to preview. Anything over this must be compressed by the
  // admin (Canva's own "compress" export option, or Acrobat/an online
  // compressor) before it is accepted — this utility has no server-side way
  // to compress a PDF itself.
  maxUploadBytes: 10 * 1024 * 1024
};

/**
 * The single publishing mode. Kept as a mode-keyed object, matching the
 * sibling MLC Admin Documents Utility's architecture, rather than refactored
 * down to a mode-less design — far less risky to reuse than rewriting every
 * function that currently keys off MODES.
 */
const MODES = {
  NEWSLETTER: {
    key: 'NEWSLETTER',
    label: 'Newsletter',
    // THE live newsletter file. Its ID must never change: the website and
    // every other resource embed this exact ID. Publishing adds a new
    // version to it via the advanced Drive service — it is never replaced
    // or recreated.
    liveFileId: '1HKx48H85HqTKFv2IWosKJYCNxHzDbZ11',
    liveFileName: 'Newsletter.pdf',
    // A fixed "document to be published" page, pushed into the LIVE file
    // above (same ID, same embed) when Disable Live is used. Blank auto-
    // creates one in the root folder on first use and remembers its ID —
    // replace the file in Drive any time to redesign the placeholder.
    placeholderFileId: '',
    archiveFolderName: 'Archive',
    // "MLC Newsletter - August 2026.pdf"
    namePrefix: 'MLC Newsletter',
    includesServiceName: false
  }
};

/** Index/audit spreadsheet, created on first run and remembered thereafter. */
const INDEX_SHEET_NAME = 'MLC Newsletter Index';
const INDEX_TAB = 'Publications';
const LOG_TAB = 'Activity Log';

/** Script Property keys used for caching resolved Drive IDs. */
const PROP_KEYS = {
  indexSheetId: 'MLC_INDEX_SHEET_ID',
  liveFilePrefix: 'MLC_LIVE_FILE_',   // + mode key
  folderPrefix: 'MLC_FOLDER_',        // + folder name
  // Whether the live file's content is currently the "document to be
  // published" placeholder rather than a real issue, and which record was
  // live immediately before it was disabled — so Disable Live is one click
  // to undo, not a trip to the Archive to find the right file.
  placeholderActivePrefix: 'MLC_PLACEHOLDER_ACTIVE_',  // + mode key
  disabledRecordPrefix: 'MLC_DISABLED_RECORD_'         // + mode key
};

const ACCEPTED_MIME = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  DOC: 'application/msword',
  GDOC: 'application/vnd.google-apps.document'
};
