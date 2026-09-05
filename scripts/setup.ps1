# Omnigent for Windows — one-shot setup helper.
#
# What it does (each step asks before running, nothing is silent):
#   1. installs uv (winget) if missing
#   2. installs the Omnigent CLI natively (uv tool install)
#   3. optionally installs WSL Ubuntu and Omnigent + Claude Code inside it
#      (recommended: this is where Claude Code / Codex sessions, slash commands,
#       skills and terminals work)
# Then it tells you to launch Omnigent for Windows, which detects everything.
#
# Run from PowerShell:
#   irm https://raw.githubusercontent.com/leobbaroni/Omnigent-windows/main/scripts/setup.ps1 | iex
# or:  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

$ErrorActionPreference = "Continue"

function Ask($question) {
  $r = Read-Host "$question [Y/n]"
  return ($r -eq "" -or $r -match '^[Yy]')
}
function Run($cmd) {
  Write-Host ""
  Write-Host ">> $cmd" -ForegroundColor Cyan
  Invoke-Expression $cmd
}

Write-Host "Omnigent for Windows setup" -ForegroundColor Green
Write-Host "Every step shows its exact command and asks first." -ForegroundColor DarkGray

# 1. uv
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  if (Ask "uv is not installed. Install it with winget?") {
    Run "winget install --id=astral-sh.uv -e --accept-source-agreements --accept-package-agreements"
    $env:PATH = "$env:USERPROFILE\.local\bin;$env:PATH"
  }
} else { Write-Host "uv: $(uv --version)" }

# 2. Omnigent (native)
$omni = Join-Path $env:USERPROFILE ".local\bin\omnigent.exe"
if (-not (Test-Path $omni)) {
  if (Ask "Install the Omnigent CLI natively (uv tool install --python 3.12 omnigent)?") {
    Run "uv tool install --python 3.12 omnigent"
  }
} else { Write-Host "Omnigent: $(& $omni --version)" }

# 3. WSL (recommended)
$distros = @()
try { $distros = (wsl.exe -l -q 2>$null) -replace "`0", "" | Where-Object { $_ -and $_ -notmatch '^docker-desktop' } } catch {}
if ($distros.Count -eq 0) {
  if (Ask "No WSL distro found. Install Ubuntu (recommended for Claude Code / Codex sessions)?") {
    Run "wsl --install -d Ubuntu"
    Write-Host "Open Ubuntu once from the Start menu to create your Linux user, then re-run this script." -ForegroundColor Yellow
    return
  }
} else {
  $d = $distros[0]
  Write-Host "WSL distro: $d"
  if (Ask "Install Omnigent inside $d (Linux installer)?") {
    Run "wsl -d $d --shell-type login -- bash -lc `"curl -fsSL https://omnigent.ai/install.sh | sh`""
  }
  if (Ask "Install Claude Code inside $d?") {
    Run "wsl -d $d --shell-type login -- bash -lc `"curl -fsSL https://claude.ai/install.sh | bash`""
  }
  if (Ask "Sign in to Claude Code inside $d now (opens Claude; finish the browser sign-in, then type /exit)?") {
    Run "wsl -d $d --shell-type login -- claude"
  }
}

Write-Host ""
Write-Host "Done. Launch Omnigent for Windows: it detects the CLI (native or WSL), and Settings > Local mode lets you pick WSL." -ForegroundColor Green
