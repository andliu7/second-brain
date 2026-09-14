<#
.SYNOPSIS
  Mechanical half of the /clean-up skill. Kills stray automation processes,
  sweeps old temp files, and emits one JSON object for the skill to read.

.DESCRIPTION
  Windows PowerShell 5.1. No && anywhere.

  What it will kill:
    * WebDriver binaries      chromedriver / geckodriver / msedgedriver / IEDriverServer / operadriver
    * Headless browsers       chrome / msedge / firefox whose command line has --headless
    * Orphaned bun            bun.exe whose parent process is gone
    * Orphaned test workers   node.exe that is BOTH parentless AND running vitest/jest/playwright

  What it will never kill:
    * Any node.exe with a living parent. The always-on stack (PM2, dashboard,
      brain, OS) lives there and losing it silently is far worse than a stray
      process surviving a sweep.
    * Any browser process without --headless. That is a real window.

  Killing is deliberately narrow. A process this script is unsure about is
  reported under "suspicious" and left running.

.PARAMETER DryRun
  Report what would happen. Kills nothing, deletes nothing.

.PARAMETER TempOlderThanDays
  Only temp files last written more than this many days ago are deleted. Default 7.

.PARAMETER LogPath
  Appended with one line per run.
#>

[CmdletBinding()]
param(
    [switch] $DryRun,
    [int]    $TempOlderThanDays = 7,
    [string] $LogPath = (Join-Path $env:USERPROFILE 'Downloads\Projects\second-brain\OS\apps\clean-up\clean-up.log')
)

$ErrorActionPreference = 'Stop'

$DRIVERS   = @('chromedriver', 'geckodriver', 'msedgedriver', 'IEDriverServer', 'operadriver')
$BROWSERS  = @('chrome', 'msedge', 'firefox')
$RUNNERS   = 'vitest|jest|playwright|puppeteer|mocha'
$HEADLESS  = '--headless'

# Temp subfolders these tools leave behind. Swept when older than 1 day
# regardless of the file-age rule, because they are never anything else.
$SCRATCH_DIRS = @(
    'puppeteer_dev_chrome_profile-*',
    'playwright-artifacts-*',
    'playwright_chromiumdev_profile-*',
    'scoped_dir*',
    '.com.google.Chrome.*',
    'chrome_BITS_*',
    'chrome_url_fetcher_*'
)

# --------------------------------------------------------------------------
# Process inventory
# --------------------------------------------------------------------------

$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
         Select-Object ProcessId, ParentProcessId, Name, CommandLine

$livePids = @{}
foreach ($p in $procs) { $livePids[[int]$p.ProcessId] = $true }

function Get-BaseName([string]$name) {
    if ([string]::IsNullOrWhiteSpace($name)) { return '' }
    return [System.IO.Path]::GetFileNameWithoutExtension($name)
}

$targets    = @()   # things to kill, with a reason
$suspicious = @()   # things a human should look at, left alone

foreach ($p in $procs) {
    $base = Get-BaseName $p.Name
    $cmd  = if ($null -eq $p.CommandLine) { '' } else { $p.CommandLine }
    $orphan = -not $livePids.ContainsKey([int]$p.ParentProcessId)

    if ($DRIVERS -contains $base) {
        $targets += [pscustomobject]@{ Pid = [int]$p.ProcessId; Name = $base; Reason = 'webdriver' }
        continue
    }

    if (($BROWSERS -contains $base) -and ($cmd -match [regex]::Escape($HEADLESS))) {
        $targets += [pscustomobject]@{ Pid = [int]$p.ProcessId; Name = $base; Reason = 'headless browser' }
        continue
    }

    if ($base -eq 'bun' -and $orphan) {
        $targets += [pscustomobject]@{ Pid = [int]$p.ProcessId; Name = $base; Reason = 'orphaned bun' }
        continue
    }

    if ($base -eq 'node' -and $orphan -and ($cmd -match $RUNNERS)) {
        $targets += [pscustomobject]@{ Pid = [int]$p.ProcessId; Name = $base; Reason = 'orphaned test worker' }
        continue
    }

    # Reported, never killed: a test runner still attached to something.
    if ($base -eq 'node' -and ($cmd -match $RUNNERS) -and -not $orphan) {
        $suspicious += [pscustomobject]@{
            Pid = [int]$p.ProcessId; Name = $base; Note = 'test runner with a live parent - left alone'
        }
    }
}

$killed = @()
$failed = @()
foreach ($t in $targets) {
    if ($DryRun) { continue }
    try {
        Stop-Process -Id $t.Pid -Force -ErrorAction Stop
        $killed += $t
    } catch {
        $failed += [pscustomobject]@{ Pid = $t.Pid; Name = $t.Name; Error = $_.Exception.Message }
    }
}

# --------------------------------------------------------------------------
# Temp sweep
# --------------------------------------------------------------------------

$temp = $env:TEMP
$freedBytes = 0
$deletedCount = 0
$deleteErrors = 0
$cutoff = (Get-Date).AddDays(-1 * $TempOlderThanDays)
$scratchCutoff = (Get-Date).AddDays(-1)

function Get-FolderBytes([string]$path) {
    try {
        $sum = (Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue |
                Measure-Object -Property Length -Sum).Sum
        if ($null -eq $sum) { return 0 }
        return [int64]$sum
    } catch { return 0 }
}

$tempBytesBefore = Get-FolderBytes $temp

if (Test-Path -LiteralPath $temp) {
    # 1. Loose files older than the cutoff.
    $old = Get-ChildItem -LiteralPath $temp -File -Force -ErrorAction SilentlyContinue |
           Where-Object { $_.LastWriteTime -lt $cutoff }
    foreach ($f in $old) {
        $size = $f.Length
        if ($DryRun) { $freedBytes += $size; $deletedCount++; continue }
        try {
            Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
            $freedBytes += $size; $deletedCount++
        } catch { $deleteErrors++ }
    }

    # 2. Known automation scratch folders older than a day.
    foreach ($pattern in $SCRATCH_DIRS) {
        $dirs = Get-ChildItem -LiteralPath $temp -Directory -Force -Filter $pattern -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -lt $scratchCutoff }
        foreach ($d in $dirs) {
            $size = Get-FolderBytes $d.FullName
            if ($DryRun) { $freedBytes += $size; $deletedCount++; continue }
            try {
                Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction Stop
                $freedBytes += $size; $deletedCount++
            } catch { $deleteErrors++ }
        }
    }
}

$tempBytesAfter = Get-FolderBytes $temp

# --------------------------------------------------------------------------
# State report
# --------------------------------------------------------------------------

$after = Get-Process -ErrorAction SilentlyContinue

$counts = $after | Group-Object -Property ProcessName |
          Sort-Object Count -Descending | Select-Object -First 8 |
          ForEach-Object { [pscustomobject]@{ Name = $_.Name; Count = $_.Count } }

$topRam = $after | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 |
          ForEach-Object {
              [pscustomobject]@{ Name = $_.ProcessName; Mb = [math]::Round($_.WorkingSet64 / 1MB) }
          }

$topCpu = $after | Where-Object { $null -ne $_.CPU } |
          Sort-Object CPU -Descending | Select-Object -First 5 |
          ForEach-Object {
              [pscustomobject]@{ Name = $_.ProcessName; CpuSeconds = [math]::Round($_.CPU) }
          }

$sysDrive = ($env:SystemDrive).TrimEnd(':')
$disk = Get-PSDrive -Name $sysDrive -ErrorAction SilentlyContinue
$freeGb = if ($null -eq $disk) { $null } else { [math]::Round($disk.Free / 1GB, 1) }

$result = [ordered]@{
    timestamp      = (Get-Date).ToString('yyyy-MM-dd HH:mm')
    dryRun         = [bool]$DryRun
    targets        = @($targets)   # what matched a kill rule, dry run or not
    killed         = @($killed)    # what actually died. Empty on a dry run
    killFailures   = @($failed)
    suspicious     = @($suspicious)
    tempFreedMb    = [math]::Round($freedBytes / 1MB, 1)
    tempItemsRemoved = $deletedCount
    tempDeleteErrors = $deleteErrors
    tempNowMb      = [math]::Round($tempBytesAfter / 1MB)
    tempBeforeMb   = [math]::Round($tempBytesBefore / 1MB)
    diskFreeGb     = $freeGb
    diskLetter     = $sysDrive
    processCounts  = @($counts)
    topRam         = @($topRam)
    topCpuSeconds  = @($topCpu)
}

# --------------------------------------------------------------------------
# Log line + output
# --------------------------------------------------------------------------

try {
    $logDir = Split-Path -Parent $LogPath
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $summarySource = if ($DryRun) { $targets } else { $killed }
    $killSummary = if ($summarySource.Count -eq 0) { 'nothing' } else { ($summarySource | ForEach-Object { $_.Name }) -join ',' }
    $prefix = if ($DryRun) { 'DRYRUN  ' } else { '' }
    $line = '{0}{1}  killed={2}  freed={3}MB  temp={4}MB  free={5}GB' -f `
            $prefix, $result.timestamp, $killSummary, $result.tempFreedMb, $result.tempNowMb, $result.diskFreeGb
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    $result.logPath = $LogPath
} catch {
    $result.logPath = "could not write log: $($_.Exception.Message)"
}

$result | ConvertTo-Json -Depth 5
