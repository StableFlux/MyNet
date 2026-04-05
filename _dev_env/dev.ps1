# Start MyNet dev environment
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $PSScriptRoot   # cd into _dev_env/

# --- .env setup ---
if (-not (Test-Path "env\.env")) {
    Write-Host "No .env found - copying from .env.example"
    Copy-Item "env\.env.example" "env\.env"

    Write-Host "Generating Fernet key..."
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $key = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_')

    $envLines = Get-Content "env\.env"
    $envLines = $envLines | ForEach-Object {
        if ($_ -match '^FERNET_KEY=\s*$') { "FERNET_KEY=$key" } else { $_ }
    }
    $envLines | Set-Content "env\.env"
    Write-Host "Fernet key written to .env"
}

# --- npm install (host) for VS Code IntelliSense ---
if (-not (Test-Path "$RepoRoot\site\frontend\node_modules")) {
    Write-Host "Installing frontend npm packages for VS Code..."
    Push-Location "$RepoRoot\site\frontend"
    npm install --silent
    Pop-Location
    Write-Host "npm install done."
}

# --- Build and start all containers (detached, wait until healthy) ---
Write-Host "Building and starting MyNet containers..."
docker compose -f docker\docker-compose.yml --env-file env\.env up --build --detach --wait

Write-Host ""
Write-Host "MyNet is running:"
Write-Host "  http://localhost"
Write-Host "  http://<your-server-ip>"
Write-Host "  API docs: http://localhost:8000/docs"
