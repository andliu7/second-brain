# sweep.ps1 - survey, clean, and organize Downloads. PowerShell 5.1 compatible.
#
#   .\sweep.ps1                 report only: what would be deleted/moved, with real sizes
#   .\sweep.ps1 -Clean          delete the regenerable junk (recycle bin where practical)
#   .\sweep.ps1 -Organize       build ~\School + ~\Documents\Personal and move things home
#   .\sweep.ps1 -Clean -Organize
#
# Rules this script lives by:
#   1. It only ever deletes things that can be re-downloaded or rebuilt.
#      Installers, datasets, node_modules, build output, caches, duplicate "(1)" archives.
#   2. Anything you made, or that is personal, is MOVED, never deleted.
#   3. Report first. Nothing happens without an explicit flag.
#   4. Everything it does is appended to Downloads\sweep-log.txt.

[CmdletBinding()]
param(
    [switch]$Clean,
    [switch]$Organize
)

$ErrorActionPreference = "Stop"
$DL   = Join-Path $env:USERPROFILE "Downloads"
$LOG  = Join-Path $DL "sweep-log.txt"
$HOME_ = $env:USERPROFILE

function Log([string]$msg) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    Add-Content -Path $LOG -Value "[$stamp] $msg"
    Write-Host $msg
}

function SizeMB($path) {
    if (-not (Test-Path $path)) { return 0 }
    $item = Get-Item $path
    if ($item.PSIsContainer) {
        $b = (Get-ChildItem $path -Recurse -Force -ErrorAction SilentlyContinue |
              Measure-Object -Property Length -Sum).Sum
    } else { $b = $item.Length }
    if ($null -eq $b) { $b = 0 }
    [math]::Round($b / 1MB, 1)
}

function Recycle($path) {
    # Recycle bin for single files: recoverable beats gone.
    Add-Type -AssemblyName Microsoft.VisualBasic
    $item = Get-Item $path
    if ($item.PSIsContainer) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path,
            'OnlyErrorDialogs', 'SendToRecycleBin')
    } else {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path,
            'OnlyErrorDialogs', 'SendToRecycleBin')
    }
}

Write-Host ""
Write-Host "  sweep - Downloads survey" -ForegroundColor Cyan
Write-Host "  ------------------------"

# ---------------------------------------------------------------- wave 1: delete
# Every entry here is re-downloadable or rebuildable. That is the entire test.

$deleteExact = @(
    @{ p = "chm13v1.1_hg002XYv2.0.fasta";        why = "genome reference - re-download from T2T/NCBI if a class ever needs it again" },
    @{ p = "cifar-10-python.tar.gz";             why = "ML dataset - one line of torchvision re-fetches it" },
    @{ p = "VSCodeUserSetup-x64-1.101.0.zip";    why = "installer - VS Code is installed; newer version ships weekly anyway" },
    @{ p = "MobaXterm_Installer_v25.0.zip";      why = "installer zip - already extracted and installed" },
    @{ p = "MobaXterm_Installer_v25.0";          why = "extracted installer folder - the app is installed" },
    @{ p = "video7368556124.zip";                why = "downloaded video zip - the mp4 is loose in Downloads too" },
    @{ p = "LG 3 10_16 - Google Slides_files";   why = "browser save-page-complete junk folder" }
)

# duplicate download archives: "archive (5) (2).zip" and friends
$dupArchives = Get-ChildItem $DL -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^archive \(\d+\)( \(\d+\))?\.zip$' }

# regenerable build trees inside Projects and class folders
$regenNames = @("node_modules", ".next", "__pycache__", "dist", ".gradle")
$regenDirs = @()
foreach ($root in @((Join-Path $DL "Projects"), (Join-Path $DL "CMSC 422"),
                    (Join-Path $DL "CMSC320"), (Join-Path $DL "CMSC335"))) {
    if (-not (Test-Path $root)) { continue }
    $regenDirs += Get-ChildItem $root -Directory -Recurse -Depth 3 -Force -ErrorAction SilentlyContinue |
        Where-Object { $regenNames -contains $_.Name } |
        Where-Object { $_.FullName -notmatch '\\node_modules\\' }   # not nested inside another
}
# dist/ is only regenerable where source sits next to it - keep the two shipped dist folders
$regenDirs = $regenDirs | Where-Object {
    -not ($_.Name -eq "dist" -and $_.FullName -match "grignard-app-dist")
}

# pibblebot is a straight copy of Pibble
$pibblebot = Join-Path $DL "Projects\pibblebot"

Write-Host ""
Write-Host "  WAVE 1 - safe to delete (re-downloadable or rebuildable)" -ForegroundColor Yellow
$total = 0
foreach ($e in $deleteExact) {
    $full = Join-Path $DL $e.p
    if (Test-Path $full) {
        $mb = SizeMB $full; $total += $mb
        Write-Host ("  {0,9:N1} MB  {1}" -f $mb, $e.p)
        Write-Host ("               {0}" -f $e.why) -ForegroundColor DarkGray
    }
}
foreach ($f in $dupArchives) {
    $mb = SizeMB $f.FullName; $total += $mb
    Write-Host ("  {0,9:N1} MB  {1}   (duplicate download)" -f $mb, $f.Name)
}
$regenTotal = 0
foreach ($d in $regenDirs) {
    $mb = SizeMB $d.FullName; $regenTotal += $mb
    Write-Host ("  {0,9:N1} MB  {1}" -f $mb, $d.FullName.Replace($DL + "\", ""))
}
if (Test-Path $pibblebot) {
    $mb = SizeMB $pibblebot
    Write-Host ("  {0,9:N1} MB  Projects\pibblebot   (duplicate of Projects\Pibble - verify, then delete)" -f $mb)
    Write-Host  "               NOT deleted automatically: confirm Pibble is the live copy first" -ForegroundColor DarkGray
}
Write-Host ("  --------- total reclaimable: ~{0:N1} GB (plus pibblebot)" -f (($total + $regenTotal) / 1024)) -ForegroundColor Green
Write-Host  "            node_modules come back with 'npm install' per project when needed"

# ---------------------------------------------------------------- wave 2: organize
$moves = @(
    @{ from = "CMSC 422";                     to = "School\CMSC422" },
    @{ from = "CMSC320";                      to = "School\CMSC320" },
    @{ from = "CMSC335";                      to = "School\CMSC335" },
    @{ from = "DAT Bootcamp Bio Anki Decks";  to = "School\DAT\Anki Decks" },
    @{ from = "Taxes";                        to = "..\Documents\Personal\Taxes" },
    @{ from = "c_visa";                       to = "..\Documents\Personal\c_visa" }
)

Write-Host ""
Write-Host "  WAVE 2 - move to a real home (never deleted)" -ForegroundColor Yellow
foreach ($m in $moves) {
    $src = Join-Path $DL $m.from
    if (Test-Path $src) {
        Write-Host ("  {0,-32} ->  {1}" -f $m.from, $m.to.Replace("..\", "~\"))
    }
}
Write-Host "  Taxes and visa documents do not belong in Downloads - Documents\Personal is"
Write-Host "  inside your user profile, backed up by anything that backs up Documents."
Write-Host ""
Write-Host "  Loose class PDFs/PPTX stay put this round. After the folders exist, sort the"
Write-Host "  ones you searched for recently; the rest age out under the 90-day rule."

# ---------------------------------------------------------------- act
if (-not $Clean -and -not $Organize) {
    Write-Host ""
    Write-Host "  Report only. Run with -Clean and/or -Organize to act." -ForegroundColor Cyan
    Write-Host ""
    exit 0
}

if ($Clean) {
    Write-Host ""
    Log "sweep -Clean started"
    foreach ($e in $deleteExact) {
        $full = Join-Path $DL $e.p
        if (Test-Path $full) {
            $mb = SizeMB $full
            try { Recycle $full; Log ("recycled {0} ({1} MB)" -f $e.p, $mb) }
            catch { Remove-Item $full -Recurse -Force; Log ("deleted {0} ({1} MB)" -f $e.p, $mb) }
        }
    }
    foreach ($f in $dupArchives) {
        try { Recycle $f.FullName; Log ("recycled dup {0}" -f $f.Name) }
        catch { Remove-Item $f.FullName -Force; Log ("deleted dup {0}" -f $f.Name) }
    }
    foreach ($d in $regenDirs) {
        # hard delete: recycling a node_modules is slower than reinstalling one
        $mb = SizeMB $d.FullName
        Remove-Item $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
        Log ("deleted {0} ({1} MB, rebuildable)" -f $d.FullName.Replace($DL + "\", ""), $mb)
    }
    Log "sweep -Clean done"
    Write-Host "  Clean done. Log: Downloads\sweep-log.txt" -ForegroundColor Green
}

if ($Organize) {
    Write-Host ""
    Log "sweep -Organize started"
    foreach ($m in $moves) {
        $src = Join-Path $DL $m.from
        $dst = Join-Path $DL $m.to
        if (-not (Test-Path $src)) { continue }
        if (Test-Path $dst) { Log ("skip {0}: destination exists" -f $m.from); continue }
        $parent = Split-Path $dst -Parent
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Move-Item -Path $src -Destination $dst
        Log ("moved {0} -> {1}" -f $m.from, $m.to)
    }
    # School goes to the user profile root, beside Downloads, not inside it
    $schoolInDL = Join-Path $DL "School"
    $schoolHome = Join-Path $HOME_ "School"
    if ((Test-Path $schoolInDL) -and (-not (Test-Path $schoolHome))) {
        Move-Item $schoolInDL $schoolHome
        Log "moved School -> ~\School"
    }
    Log "sweep -Organize done"
    Write-Host "  Organize done. Classes: ~\School   Personal: ~\Documents\Personal" -ForegroundColor Green
}

Write-Host ""
Write-Host "  After any change: reindex the brain so q.py sees the new layout:" -ForegroundColor Cyan
Write-Host "    cd $HOME_\Downloads\Projects\second-brain\second-brain; python idx.py"
Write-Host ""
