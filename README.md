# MLC Comms Newsletter Utility

A Google Apps Script web app for the Midrand Lutheran Church communications
team. It publishes the church **newsletter** to Drive, keeps a dated archive
of every past issue, and — critically — keeps the live file's Drive ID stable
so the embed on the website never breaks.

A sibling of the [MLC Admin Docs Utility](https://github.com/27siya/mlc-admin-docs-utility)
(liturgy + announcements), simplified to one document type and reskinned
pastel red instead of pastel blue. Restricted to `comms@midrandlutheranchurch.co.za`
only.

---

## What it does

**Publish tab.** Pick the issue month (defaults to the current month), upload
a PDF or Word document, publish. The upload becomes the live document; a
permanent, dated copy goes into the archive.

**Archive tab.** Every past issue, searchable by month, issue name or notes.
Any of them can be made the active document, re-dated, renamed, downloaded, or
removed.

**Status sidebar.** What is live right now, the embed URL to paste into the
website, this issue's publishing history, and a setup check. Sits beside both
Publish and Archive rather than being a tab of its own.

### The things worth knowing

- **The issue month is the source of truth, not the filename.** Newsletters
  are grouped by Month + Year — there is no per-service calendar to suggest a
  name from, so Issue Name starts blank and is entirely free text. Nothing in
  the system reads meaning back out of a filename — the binding between a
  file and an issue lives in the index spreadsheet.
- **The live file keeps its Drive ID for ever.** It is pinned by ID in
  `Config.js`:

  | Document | File ID |
  |---|---|
  | Newsletter | `1HKx48H85HqTKFv2IWosKJYCNxHzDbZ11` |

  Publishing uses Drive's **Manage file versions** feature — `files.update`
  with `keepRevisionForever` — to add a new version *to that exact file*. It
  is never replaced, recreated, renamed or looked up by name, so the embed
  pointing at that ID simply shows the new document. This is why the advanced
  Drive service is required: `DriveApp` alone cannot add a version.

  If the file cannot be opened, publishing **fails loudly** rather than
  creating a substitute — a substitute would leave the website showing a
  stale document for ever.
- **Uploads are capped at 10MB.** A Canva-exported newsletter can easily run
  50-100MB+ before compression, and a file that large fails to display
  properly in the website's Drive embed. This utility has no server-side way
  to compress a PDF, so oversized uploads are rejected outright with a
  message pointing the admin to Canva's own "compress" export option (or
  Acrobat / an online PDF compressor).
- **Word documents are converted to PDF** for the live file (a Drive file's
  type cannot change between revisions), and the original `.docx` is kept
  beside the PDF in the archive so the editable source is never lost.
- **Sharing is re-asserted on every publish**: anyone with the link can view
  and download; nobody outside the team can edit.
- **Nothing is ever hard-deleted.** "Delete file" moves a document to Drive's
  bin, where it can be restored for 30 days. The live file itself cannot be
  deleted through the utility at all.

---

## Repository layout

```
Newsletter Utility/
├── Script/                    # the Apps Script project (clasp root)
│   ├── appsscript.json        # manifest — scopes and the advanced Drive service
│   ├── Config.js              # folder ID, admin email, modes, build number
│   ├── Utils.js               # helpers, auth guard, Drive lookups, month/year normalisation
│   ├── DriveOps.js            # conversion, revisioning, sharing, archiving
│   ├── Data_Documents.js      # publishing logic and the publication index
│   ├── HelpGuideContent.js    # help guide sections + Doc rendering
│   ├── Code.js                # doGet, bootstrap, diagnostics
│   ├── index.html             # shell
│   ├── CSS_Styles.html        # MLC palette, pastel red drawn from the church site
│   ├── JS_Main.html           # state, routing, viewer panel, busy overlay, modals, toasts
│   ├── JS_Pages_Publish.html  # publish tab
│   ├── JS_Pages_Archive.html  # archive tab
│   ├── JS_Pages_Status.html   # sidebar
│   ├── AuthError.html         # shown to accounts that are not on the allowlist
│   └── deploy.ps1             # bump build, push, redeploy
├── assets/
├── clasp-account.ps1          # switch clasp's active Google account
├── .gitignore
└── README.md
```

---

## First-time setup

The Apps Script project must be **created and owned by
`comms@midrandlutheranchurch.co.za`**, so these steps have to be done while
signed in as that account.

### 1. Create the Apps Script project

1. Sign in to Google as `comms@midrandlutheranchurch.co.za`.
2. Go to <https://script.google.com> and create a **New project**.
3. Rename it **Newsletter Utility**.
4. Copy the **Script ID** from *Project Settings*.

### 2. Point clasp at it

From the `Script/` directory, signed in as the same account:

```bash
clasp login
```

Then create `Script/.clasp.json`:

```json
{
  "scriptId": "PASTE_THE_SCRIPT_ID_HERE",
  "rootDir": "."
}
```

> **`comms@` covers both MLC comms projects.** This project and the MLC Admin
> Docs Utility are both owned by `comms@midrandlutheranchurch.co.za`, so no
> account switching is needed between them — only when coming from `tbl@`
> (the TBL Web Portal). Use the included switcher:
>
> ```powershell
> .\clasp-account.ps1            # show the active account and saved profiles
> .\clasp-account.ps1 comms      # switch to comms@ (this project)
> .\clasp-account.ps1 tbl        # switch to tbl@ (TBL Web Portal)
> ```
>
> A push or deploy failing with a 403 or "requested entity was not found" is
> almost always the wrong account being active.

### 3. Push the code

```bash
clasp push -f
```

If it fails with "User has not enabled the Apps Script API", enable it once
at <https://script.google.com/home/usersettings> for `comms@`.

### 4. Enable the advanced Drive service

In the Apps Script editor: **Services** → **+** → **Drive API** → version **v3**,
identifier `Drive`. (The manifest already declares it, so a successful push
usually enables it — confirm it is listed.)

### 5. Deploy

```bash
clasp deploy -d "Build #1 - initial"
```

Copy the returned **deployment ID** into `$DEPLOYMENT_ID` at the top of
`deploy.ps1`. From then on, every deploy is just:

```bash
./deploy.ps1
```

which bumps `PORTAL_BUILD`, pushes, and redeploys to the same URL.

### 6. Authorise and check

Open the web app URL, authorise the scopes, then open **Setup Check** in the
sidebar and run it. All rows should read OK. On first run the utility creates
the **MLC Newsletter Index** spreadsheet in the Drive folder — that is the
publication index and activity log.

### 7. Confirm file access

`comms@` needs **Editor** access to the live newsletter file itself (not just
the containing folder) — Drive versioning needs edit rights on the specific
file.

---

## Configuration

Everything adjustable lives in `Script/Config.js`:

| Setting | Purpose |
|---|---|
| `rootFolderId` | The Drive folder holding the live file and archive subfolder |
| `adminEmails` | The only account permitted to use the utility |
| `logoFileId` | Reused from the MLC Admin Docs Utility's own root folder |
| `maxUploadBytes` | Upload ceiling (10 MB — kept low so embeds display cleanly) |
| `MODES` | The single `NEWSLETTER` mode and its live filename |

> **Note on the allowlist:** `adminEmails` is matched against the actual
> signed-in Google account. If `comms@` is a group or an alias rather than a
> real account, add the underlying account instead.

---

## Embedding on the website

From the sidebar's **Embed Code**, copy the address to paste into the
website. It never changes, so the website needs no edit when a new issue is
published:

```html
<iframe src="https://drive.google.com/file/d/<file-id>/preview"
        width="100%" height="800"></iframe>
```
