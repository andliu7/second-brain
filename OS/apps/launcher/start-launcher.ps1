# Starts the skill launcher and opens it in your browser.
# PowerShell 5.1 -- no && anywhere in here.
#
#   cd C:\Users\zeusa\Downloads\Projects\second-brain\OS\apps\launcher
#   .\start-launcher.ps1
#
# If PowerShell refuses to run it, either unblock it once:
#   Unblock-File .\start-launcher.ps1
# or just run the server directly:
#   python launcher.py

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$python = Get-Command python -ErrorAction SilentlyContinue
if ($null -eq $python) {
    Write-Host "python is not on PATH. Install Python 3 or run launcher.py by full path." -ForegroundColor Red
    exit 1
}

$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($null -eq $claude) {
    Write-Host "Warning: 'claude' is not on PATH, so every button will fail." -ForegroundColor Yellow
    Write-Host "Check with:  claude --version" -ForegroundColor Yellow
    Write-Host ""
}

python launcher.py
