# Wipe the database volume and restart — use in dev only.
$ErrorActionPreference = "Stop"

Set-Location (Split-Path $PSScriptRoot -Parent)   # cd into _dev_env/

Write-Host "WARNING: This will delete all MyNet data. Press Ctrl+C to cancel." -ForegroundColor Yellow
Start-Sleep -Seconds 3

docker compose -f docker\docker-compose.yml --env-file env\.env down
docker volume rm mynet_dev_db 2>$null
Write-Host "Database wiped. Run: .\_dev_env\dev.ps1"
