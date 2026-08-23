# MLC Comms Newsletter Utility — deploy script.
# Bumps PORTAL_BUILD, pushes to Apps Script, and redeploys the web app.
# Run from the Script directory: .\deploy.ps1

$DEPLOYMENT_ID = "AKfycbwQO93_JtK11oxOTcp4JgIvIP2TNWRWY8wrVEP3-5VFEtSZ9CJg-43MHxjcxDcS_AAn"
$CONFIG_FILE   = "$PSScriptRoot\Config.js"

# --- 1. Bump PORTAL_BUILD ---
$content = Get-Content $CONFIG_FILE -Raw
if ($content -match 'const PORTAL_BUILD = (\d+);') {
    $old = [int]$Matches[1]
    $new = $old + 1
    $content = $content -replace "const PORTAL_BUILD = $old;", "const PORTAL_BUILD = $new;"
    Set-Content $CONFIG_FILE $content -NoNewline
    Write-Host "PORTAL_BUILD: $old -> $new"
} else {
    Write-Error "Could not find PORTAL_BUILD in Config.js"
    exit 1
}

# --- 2. Push ---
Write-Host "`nPushing..."
clasp push -f
if ($LASTEXITCODE -ne 0) { Write-Error "clasp push failed"; exit 1 }

# --- 3. Deploy ---
if ($DEPLOYMENT_ID -eq "REPLACE_WITH_DEPLOYMENT_ID") {
    Write-Host "`nNo deployment ID set yet." -ForegroundColor Yellow
    Write-Host "Create the first deployment with:"
    Write-Host "  clasp deploy -d 'Build #$new - initial'"
    Write-Host "then paste the returned deployment ID into `$DEPLOYMENT_ID at the top of this script."
    exit 0
}

$date = Get-Date -Format "yyyy-MM-dd HH:mm"
$desc = "Build #$new - $date SAST"
Write-Host "`nDeploying: $desc"
clasp deploy -i $DEPLOYMENT_ID -d $desc
if ($LASTEXITCODE -ne 0) { Write-Error "clasp deploy failed"; exit 1 }

Write-Host "`nDone. The utility is now at build #$new." -ForegroundColor Green
