# Switch the clasp login between Google accounts.
#
# clasp stores one credential globally in ~/.clasprc.json, so working on
# projects owned by different accounts means swapping it. This keeps a copy of
# each account's credential in ~/.clasp-accounts and swaps the active one.
#
#   .\clasp-account.ps1              # show the active account and what is saved
#   .\clasp-account.ps1 comms        # switch to comms@midrandlutheranchurch.co.za
#   .\clasp-account.ps1 tbl          # switch back to tbl@midrandlutheranchurch.co.za
#   .\clasp-account.ps1 -Save comms  # save the CURRENT login under the name "comms"
#
# To add an account: run `clasp login`, sign in as that account, then
# `.\clasp-account.ps1 -Save <name>`.

param(
    [Parameter(Position = 0)]
    [string]$Account,

    [switch]$Save
)

$store  = Join-Path $HOME ".clasp-accounts"
$active = Join-Path $HOME ".clasprc.json"

if (-not (Test-Path $store)) { New-Item -ItemType Directory -Path $store | Out-Null }

function Show-Active {
    if (-not (Test-Path $active)) {
        Write-Host "Not logged in to clasp." -ForegroundColor Yellow
        return
    }
    $who = (clasp show-authorized-user 2>&1 | Select-Object -First 1)
    Write-Host "Active: $who"
}

# --- Save the current credential under a name ---
if ($Save) {
    if (-not $Account) { Write-Error "Give the account a name, e.g. .\clasp-account.ps1 -Save comms"; exit 1 }
    if (-not (Test-Path $active)) { Write-Error "No active clasp login to save. Run 'clasp login' first."; exit 1 }

    Copy-Item $active (Join-Path $store "$Account.json") -Force
    Write-Host "Saved the current login as '$Account'." -ForegroundColor Green
    Show-Active
    exit 0
}

# --- No argument: report state ---
if (-not $Account) {
    Show-Active
    Write-Host "`nSaved accounts:"
    Get-ChildItem $store -Filter *.json -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host ("  " + $_.BaseName)
    }
    Write-Host "`nSwitch with: .\clasp-account.ps1 <name>"
    exit 0
}

# --- Switch ---
$target = Join-Path $store "$Account.json"
if (-not (Test-Path $target)) {
    Write-Error "No saved credential called '$Account'. Saved: $((Get-ChildItem $store -Filter *.json | ForEach-Object BaseName) -join ', ')"
    exit 1
}

# Never lose the credential currently in place — stash it back to its own file
# first if we can work out which account it belongs to.
if (Test-Path $active) {
    $current = (clasp show-authorized-user 2>&1 | Select-Object -First 1)
    Write-Host "Currently: $current"
}

Copy-Item $target $active -Force
Write-Host "Switched to '$Account'." -ForegroundColor Green
Show-Active
