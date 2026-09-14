#Requires -Version 5.1
<#
.SYNOPSIS
    Quiz Master launcher - build, run and manage the Docker stack.

.DESCRIPTION
    Wraps the common docker-compose commands for this project.
    Docker Desktop is started automatically if the engine isn't running.

.PARAMETER Action
    start    Build images from source and start the stack (default)
    prod     Pull the pre-built GHCR images and start them
    stop     Stop and remove the containers (database + uploads are kept)
    restart  Restart all services, or one named service
    logs     Follow logs for one service (default: backend)
    status   Show the running containers
    wipe     DESTRUCTIVE - stop and delete the database + uploads volumes
    urls     Print the portal URLs and the admin password hint

.PARAMETER Service
    Service name for restart/logs:
    postgres | backend | frontend-admin | frontend-slideshow | frontend-quizzer

.EXAMPLE
    .\start.ps1
    .\start.ps1 prod
    .\start.ps1 logs frontend-admin
    .\start.ps1 restart frontend-quizzer
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'prod', 'stop', 'restart', 'logs', 'status', 'wipe', 'urls')]
    [string]$Action = 'start',

    [Parameter(Position = 1)]
    [string]$Service = 'backend'
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$DevCompose  = 'docker-compose.yml'
$ProdCompose = 'docker-compose.prod.yml'

function Write-Step { param([string]$Text) Write-Host "`n>> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "   $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "   $Text" -ForegroundColor Yellow }

# ── Compose command (v2 plugin preferred, v1 binary as fallback) ──────────────
$script:Compose = $null
function Get-Compose {
    if ($script:Compose) { return $script:Compose }
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        docker compose version *> $null
        if ($LASTEXITCODE -eq 0) { $script:Compose = @('docker', 'compose'); return $script:Compose }
    }
    if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
        $script:Compose = @('docker-compose'); return $script:Compose
    }
    throw 'Neither "docker compose" nor "docker-compose" was found. Install Docker Desktop first.'
}

function Invoke-Compose {
    param([string[]]$Arguments)
    $exe  = (Get-Compose)[0]
    $pre  = (Get-Compose)[1..((Get-Compose).Count - 1)]
    & $exe @pre @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose $($Arguments -join ' ') failed (exit $LASTEXITCODE)." }
}

# ── Ensure the Docker engine is up (start Docker Desktop if needed) ───────────
function Assert-Docker {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { return }

    $desktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path -LiteralPath $desktop)) {
        throw 'Docker is not running and Docker Desktop was not found. Start Docker and retry.'
    }

    Write-Step 'Docker is not running - starting Docker Desktop...'
    Start-Process -FilePath $desktop | Out-Null
    foreach ($i in 1..60) {
        Start-Sleep -Seconds 2
        docker info *> $null
        if ($LASTEXITCODE -eq 0) { Write-Ok 'Docker engine is ready.'; return }
    }
    throw 'Docker Desktop did not become ready within 2 minutes.'
}

# ── Ensure .env exists ────────────────────────────────────────────────────────
function Assert-EnvFile {
    if (Test-Path -LiteralPath '.env') { return }
    if (-not (Test-Path -LiteralPath '.env.example')) { return }
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    Write-Warn '.env was missing - created it from .env.example. Edit it before exposing the dashboard.'
}

# ── Portal URLs (honours port overrides from .env) ────────────────────────────
function Get-EnvValue {
    param([string]$Key, [string]$Default)
    if (-not (Test-Path -LiteralPath '.env')) { return $Default }
    $line = Get-Content -LiteralPath '.env' |
        Where-Object { $_ -match "^\s*$([regex]::Escape($Key))\s*=" } |
        Select-Object -Last 1
    if (-not $line) { return $Default }
    $value = ($line -split '=', 2)[1].Trim()
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value
}

function Show-Urls {
    $admin = Get-EnvValue 'ADMIN_PORT' '3001'
    $show  = Get-EnvValue 'SLIDESHOW_PORT' '3002'
    $quiz  = Get-EnvValue 'QUIZZER_PORT' '3003'
    $pw    = Get-EnvValue 'ADMIN_PASSWORD' 'admin'

    $adminUrl = Get-EnvValue 'ADMIN_URL'     "http://localhost:$admin"
    $showUrl  = Get-EnvValue 'SLIDESHOW_URL' "http://localhost:$show"
    $quizUrl  = Get-EnvValue 'QUIZZER_URL'   "http://localhost:$quiz"

    Write-Host ''
    Write-Host '   Admin Dashboard  ' -NoNewline; Write-Host $adminUrl -ForegroundColor Cyan
    Write-Host '   Slideshow        ' -NoNewline; Write-Host $showUrl  -ForegroundColor Cyan
    Write-Host '   Quizzer Portal   ' -NoNewline; Write-Host $quizUrl  -ForegroundColor Cyan
    Write-Host "   Admin password   $pw" -ForegroundColor DarkGray
}

# ── Actions ───────────────────────────────────────────────────────────────────
switch ($Action) {
    'start' {
        Assert-Docker
        Assert-EnvFile
        Write-Step 'Building images and starting the stack (local dev)...'
        Invoke-Compose @('-f', $DevCompose, 'up', '-d', '--build')
        Write-Ok 'Stack is up.'
        Show-Urls
    }
    'prod' {
        Assert-Docker
        Assert-EnvFile
        Write-Step 'Pulling pre-built images from GHCR...'
        Invoke-Compose @('-f', $ProdCompose, 'pull')
        Write-Step 'Starting the stack...'
        Invoke-Compose @('-f', $ProdCompose, 'up', '-d')
        Write-Ok 'Stack is up.'
        Show-Urls
    }
    'stop' {
        Write-Step 'Stopping the stack (database and uploads are kept)...'
        Invoke-Compose @('-f', $DevCompose, 'down')
        Write-Ok 'Stopped.'
    }
    'restart' {
        Write-Step "Restarting $Service..."
        Invoke-Compose @('-f', $DevCompose, 'restart', $Service)
        Write-Ok "Restarted $Service."
    }
    'logs' {
        Write-Step "Following logs for $Service (Ctrl+C to stop)..."
        Invoke-Compose @('-f', $DevCompose, 'logs', '-f', $Service)
    }
    'status' {
        Invoke-Compose @('-f', $DevCompose, 'ps')
    }
    'wipe' {
        Write-Warn 'This DELETES the database (questions, quizzes, sessions) and all uploaded media.'
        $answer = Read-Host 'Type WIPE to confirm'
        if ($answer -ne 'WIPE') { Write-Host 'Aborted.'; break }
        Write-Step 'Removing containers and volumes...'
        Invoke-Compose @('-f', $DevCompose, 'down', '-v')
        Write-Ok 'Everything removed.'
    }
    'urls' {
        Show-Urls
    }
}
