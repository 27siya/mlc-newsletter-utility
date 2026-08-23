/**
 * @fileoverview Help guide content and the Drive document it is published as.
 *
 * The guide is written once here, then rendered to a Google Doc in the root
 * folder so admins have a normal, shareable document alongside the
 * newsletter — not just a modal inside the app. The Help button opens that
 * Doc directly.
 * @version 1.0.0
 */

const HELP_DOC_NAME = 'MLC Comms Newsletter Utility — Help Guide';

/**
 * Section content as plain paragraphs/bullets. Kept as data rather than
 * hand-built Doc API calls so the guide is easy to extend without touching
 * the rendering code below.
 */
function helpGuideSections_() {
  return [
    {
      heading: 'What This Utility Does',
      body: [
        'Publishes the church newsletter to Drive. The link the website embeds ' +
        'never changes — publishing swaps the document behind it, in place, ' +
        'using Drive’s own version history.',
        'Every issue is bound to a Month + Year, which is what the system ' +
        'actually goes by — not the filename. You can rename files freely.'
      ]
    },
    {
      heading: 'Publishing An Issue',
      body: [
        '1. Choose the file. One at a time — a publish is always a single document.',
        '2. Set the month and year this issue is for. Defaults to the current month.',
        '3. Issue Name and Archive Filename are freely editable — there is no computed ' +
        'suggestion to lock, unlike a per-service calendar. Set Issue Name to whatever ' +
        'you like (e.g. "Second Quarter Edition"); Archive Filename defaults to ' +
        '"MLC Newsletter - August 2026" and can be edited with the lock icon.',
        '4. Choose a button:',
        '   • Upload & Publish As Live — files the document and makes it the one the congregation sees.',
        '   • Upload Only — files it in the archive without touching what is currently live. Use this to ' +
        'stage next month’s newsletter in advance.',
        'If a document already exists for that month, both buttons re-label themselves to make clear what ' +
        'will happen — including a specific warning if the existing document is the one currently live.'
      ]
    },
    {
      heading: 'File Size',
      body: [
        'Uploads are capped at ' + '10MB. A Canva export can easily run 50-100MB+ before compression, and a ' +
        'file that large fails to display properly in the website’s Drive embed. Use Canva’s own "compress" ' +
        'export option (or Acrobat / an online PDF compressor) before uploading — this utility has no way to ' +
        'compress a PDF itself.'
      ]
    },
    {
      heading: 'The Archive',
      body: [
        'Every dated issue, searchable by month, issue name, or notes. Each one offers:',
        '   • View / Download — the file itself, and the original Word document where one was converted.',
        '   • Set as Live — makes this document the live one, whatever its date. Any archived document can ' +
        'be made live at any time.',
        '   • Edit Details — correct the month/year, issue name, or notes without touching the file.',
        '   • Remove Date — un-binds the document from its issue period. The file stays in the archive, ' +
        'now undated.',
        '   • Delete File — moves the file to Drive’s bin (recoverable there for about 30 days). Requires ' +
        'typing DELETE to confirm. The live file itself can never be deleted this way.',
        '"Files Without A Service Date" lists documents sitting in the archive folder that were filed by hand. ' +
        'Give one a month/year with "Set Service Date", or publish it straight to live with "Publish As Live" — ' +
        'the period is asked for first, since a published document must always have one.'
      ]
    },
    {
      heading: 'Taking The Newsletter Down',
      body: [
        'From the sidebar, "Disable Live" replaces the live document with a placeholder reading ' +
        '"Document To Be Published" on the church’s pastel red. The link is unchanged, so the website keeps ' +
        'working — it just shows the placeholder instead of a stale newsletter. Reverse it at any time by ' +
        'publishing something new, or using Set as Live on an archived document.'
      ]
    },
    {
      heading: 'A Live File With No Issue Date',
      body: [
        'The very first newsletter file may show "no service date recorded" if it was published before this ' +
        'utility existed. A prompt to set one appears wherever this is noticed — on the sidebar and on the ' +
        'Publish tab. Setting it takes a permanent copy into the archive and records it; the live file itself ' +
        'is untouched.'
      ]
    },
    {
      heading: 'Access',
      body: [
        'Restricted to the communications account. Every publish, restore, date change and removal is ' +
        'written to the Activity Log tab of the MLC Newsletter Index spreadsheet in the Drive folder.'
      ]
    }
  ];
}

/**
 * Render the guide into a Google Doc, creating it on first run and rewriting
 * its content on every subsequent call so it never drifts from what is coded
 * here. Returns the Doc's file ID.
 */
function ensureHelpGuideDoc_() {
  const root = getRootFolder_();
  let docId = props_().getProperty('MLC_HELP_DOC_ID');

  if (docId) {
    try { DocumentApp.openById(docId); }
    catch (e) { docId = null; props_().deleteProperty('MLC_HELP_DOC_ID'); }
  }

  if (!docId) {
    const existing = root.getFilesByName(HELP_DOC_NAME);
    if (existing.hasNext()) {
      docId = existing.next().getId();
    } else {
      const doc = DocumentApp.create(HELP_DOC_NAME);
      DriveApp.getFileById(doc.getId()).moveTo(root);
      docId = doc.getId();
    }
    props_().setProperty('MLC_HELP_DOC_ID', docId);
  }

  writeHelpGuideBody_(docId);
  enforcePublicRead_(docId);
  return docId;
}

function writeHelpGuideBody_(docId) {
  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();
  body.clear();

  const title = body.appendParagraph('MLC Comms Newsletter Utility — Help Guide');
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);

  const updated = body.appendParagraph('Generated ' + Utilities.formatDate(new Date(),
    Session.getScriptTimeZone(), 'd MMMM yyyy'));
  updated.setItalic(true);
  updated.editAsText().setForegroundColor('#5A6472');

  helpGuideSections_().forEach(section => {
    const h = body.appendParagraph(section.heading);
    h.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    section.body.forEach(line => {
      const p = body.appendParagraph(line);
      p.setSpacingAfter(6);
    });
  });

  doc.saveAndClose();
}

/**
 * URL of the help guide, creating/refreshing the Doc if needed.
 */
function getHelpGuideUrl() {
  requireAdmin_();
  try {
    const docId = ensureHelpGuideDoc_();
    return createSuccess({
      url: 'https://docs.google.com/document/d/' + docId + '/view',
      // Google Docs will only render inside an <iframe> from its own /preview
      // path — /view refuses to frame, which is why the panel uses this one.
      embedUrl: 'https://docs.google.com/document/d/' + docId + '/preview'
    });
  } catch (e) {
    logError_('getHelpGuideUrl', e);
    return createError('Could not open the help guide: ' + e.message, 'HELP_FAILED');
  }
}
