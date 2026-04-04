# Deploy MyNet to production
# Run this script from the repo root or the deploy/ directory.
$ErrorActionPreference = "Stop"

$DeployDir = $PSScriptRoot
$RepoRoot  = Split-Path $DeployDir -Parent
Set-Location $DeployDir

# --- .env setup ---
if (-not (Test-Path "env\.env")) {
    if (-not (Test-Path "env\.env.example")) {
        Write-Error "env/.env.example not found. Are you in the right directory?"
        exit 1
    }
    Copy-Item "env\.env.example" "env\.env"
    Write-Host ""
    Write-Host "Created env/.env from template."

    # Auto-generate JWT secret key
    $secret = & python -c "import secrets; print(secrets.token_hex(32))" 2>$null
    if ($secret) {
        $envLines = Get-Content "env\.env"
        $envLines = $envLines | ForEach-Object {
            if ($_ -match '^JWT_SECRET_KEY=\s*$') { "JWT_SECRET_KEY=$secret" } else { $_ }
        }
        $envLines | Set-Content "env\.env"
        Write-Host "Generated JWT_SECRET_KEY and saved to env/.env."
    } else {
        Write-Host ""
        Write-Host "WARNING: Could not auto-generate JWT_SECRET_KEY (Python not found on PATH)."
        Write-Host "You MUST set JWT_SECRET_KEY in env/.env before starting, or the app will"
        Write-Host "use an ephemeral key that invalidates all sessions on each restart."
        Write-Host ""
        Write-Host "Generate one with:"
        Write-Host "  python -c `"import secrets; print(secrets.token_hex(32))`""
        Write-Host ""
    }

    Write-Host "Review env/.env and set APP_URL to your server's address, then re-run this script."
    exit 0
}

# --- Verify JWT secret is set ---
$envContent = Get-Content "env\.env" -Raw
if ($envContent -match 'JWT_SECRET_KEY=\s*(\r?\n|$)') {
    Write-Host ""
    Write-Host "WARNING: JWT_SECRET_KEY is empty in env/.env."
    Write-Host "The app will start but will generate a new ephemeral key on every restart,"
    Write-Host "invalidating all user sessions. Set a permanent key for production."
    Write-Host ""
}

# --- Build and start ---
Write-Host "Building and starting MyNet (production)..."
docker compose -f docker-compose.yml --env-file env\.env up --build --detach --wait

$appUrl = if ($envContent -match 'APP_URL=(.+)') { $Matches[1].Trim() } else { "http://localhost" }
$port   = if ($envContent -match 'PORT=(\d+)')   { $Matches[1].Trim() } else { "80" }

Write-Host ""
Write-Host "MyNet is running at $appUrl"
if ($port -ne "80") {
    Write-Host "  (bound to host port $port)"
}
