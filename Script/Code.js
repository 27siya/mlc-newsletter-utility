/**
 * @fileoverview Web app entry point for the MLC Comms Newsletter Utility.
 * @version 1.0.0
 */

function doGet(e) {
  const email = getActiveEmail_();
  const logoUrl = getLogoUrl_();

  if (!email || !isAuthorisedAdmin_(email)) {
    const appUrl = ScriptApp.getService().getUrl();
    const template = HtmlService.createTemplateFromFile('AuthError');
    template.userEmail = email || '';
    template.logoUrl = logoUrl;
    template.logoutAndLoginUrl =
      'https://www.google.com/accounts/Logout?continue=https://appengine.google.com/_ah/logout?continue=' +
      encodeURIComponent(appUrl);
    return template.evaluate()
      .setTitle('Not Authorised - Midrand Lutheran Church')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const template = HtmlService.createTemplateFromFile('index');
  template.logoUrl = logoUrl;
  template.userEmail = email;
  template.build = PORTAL_BUILD;

  return template.evaluate()
    .setTitle('MLC Comms Newsletter Utility')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Everything the UI needs for its first paint, in one round trip.
 */
function getBootstrap() {
  requireAdmin_();
  const defaultMonth = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  const defaultDate = normaliseMonthToIso_(defaultMonth);

  return createSuccess({
    user: { email: getActiveEmail_() },
    build: PORTAL_BUILD,
    logoUrl: getLogoUrl_(),
    modes: Object.keys(MODES).map(k => ({
      key: k,
      label: MODES[k].label,
      liveFileName: MODES[k].liveFileName,
      archiveFolderName: MODES[k].archiveFolderName
    })),
    defaultMonth: defaultMonth,
    defaultDate: defaultDate,
    driveFolderUrl: 'https://drive.google.com/drive/folders/' + GLOBAL_CONFIG.rootFolderId,
    maxUploadBytes: GLOBAL_CONFIG.maxUploadBytes,
    liveStatus: getLiveStatus().data
  });
}

/**
 * One-time setup check, surfaced in the UI so a misconfigured folder is
 * obvious rather than mysterious.
 */
function runDiagnostics() {
  requireAdmin_();
  const checks = [];

  try {
    const root = getRootFolder_();
    checks.push({ name: 'Drive folder', ok: true, detail: root.getName() });
  } catch (e) {
    checks.push({ name: 'Drive folder', ok: false, detail: 'Cannot open the configured folder: ' + e.message });
    return createSuccess({ checks: checks });
  }

  Object.keys(MODES).forEach(key => {
    const mode = MODES[key];
    try {
      const folder = getArchiveFolder_(mode.archiveFolderName);
      checks.push({ name: mode.label + ' archive', ok: true, detail: folder.getName() });
    } catch (e) {
      checks.push({ name: mode.label + ' archive', ok: false, detail: e.message });
    }

    // The pinned live file is the one the website embeds. If this check fails,
    // publishing must not proceed — a new file would leave the embeds stale.
    const attempt = tryGetLiveFile_(key);
    checks.push({
      name: mode.label + ' live file',
      ok: !!attempt.file,
      detail: attempt.file
        ? attempt.file.getName() + ' — ' + humanFileSize_(attempt.file.getSize()) +
          ' — id ' + mode.liveFileId
        : (attempt.error || 'Not found.')
    });
  });

  try {
    const ss = getIndexSpreadsheet_();
    checks.push({ name: 'Index spreadsheet', ok: true, detail: ss.getName() });
  } catch (e) {
    checks.push({ name: 'Index spreadsheet', ok: false, detail: e.message });
  }

  try {
    Drive.Files.get(GLOBAL_CONFIG.rootFolderId, { fields: 'id', supportsAllDrives: true });
    checks.push({ name: 'Drive API (versioning)', ok: true, detail: 'Advanced Drive service reachable' });
  } catch (e) {
    checks.push({ name: 'Drive API (versioning)', ok: false, detail: 'Enable the advanced Drive service: ' + e.message });
  }

  return createSuccess({ checks: checks });
}
