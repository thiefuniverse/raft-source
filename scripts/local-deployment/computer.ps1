param(
    [Parameter(Mandatory = $true)][string]$DeploymentRoot,
    [Parameter(Mandatory = $true)][string[]]$Command,
    [string]$ProxyUrl
)

$ErrorActionPreference = 'Stop'
$DeploymentRoot = [IO.Path]::GetFullPath($DeploymentRoot)
$env:RAFT_HOME = Join-Path $DeploymentRoot 'windows\data'
if ($ProxyUrl) {
    $env:HTTP_PROXY = $ProxyUrl
    $env:HTTPS_PROXY = $ProxyUrl
    $env:NO_PROXY = 'localhost,127.0.0.1,::1'
    $env:NODE_USE_ENV_PROXY = '1'
}
$binary = Join-Path $DeploymentRoot 'windows\bin\raft-computer-win32-x64.exe'
if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
    throw "Windows Raft Computer is missing: $binary"
}
& $binary @Command
if ($LASTEXITCODE -ne 0) { throw "Raft Computer failed with exit code $LASTEXITCODE" }
