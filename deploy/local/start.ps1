$ErrorActionPreference = 'Stop'
$localRoot = $PSScriptRoot
$envFile = Join-Path $localRoot '.env'
$credentialsFile = Join-Path $localRoot '.credentials.json'
if (-not (Test-Path -LiteralPath $envFile)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $s3Secret = [Convert]::ToBase64String($bytes)
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $setupSecret = [Convert]::ToBase64String($bytes)
    [IO.File]::WriteAllText($envFile, "LOCAL_S3_USER=shippinlocal`nLOCAL_S3_PASSWORD=$s3Secret`nLOCAL_RECOVERY_ADMIN=setup:$setupSecret`n")
}
$composeFile = Join-Path $localRoot 'compose.yaml'
docker compose -f $composeFile up -d --build --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw 'Docker stack did not become healthy.' }
if (-not (Test-Path -LiteralPath $credentialsFile)) {
    py -3.11 (Join-Path $localRoot 'bootstrap.py')
    if ($LASTEXITCODE -ne 0) { throw 'Initial setup failed; inspect the stack before retrying.' }
    $content = [IO.File]::ReadAllText($envFile)
    $content = [regex]::Replace($content, '(?m)^LOCAL_RECOVERY_ADMIN=.*$', 'LOCAL_RECOVERY_ADMIN=')
    [IO.File]::WriteAllText($envFile, $content)
    docker compose -f $composeFile up -d --wait --wait-timeout 120 mail
    if ($LASTEXITCODE -ne 0) { throw 'Mail did not restart after setup.' }
}
Write-Output 'Docker mail UI: http://127.0.0.1:28080/mail'
Write-Output 'Administrator credentials: deploy/local/.credentials.json (local, git-ignored)'
