param(
    [Parameter(Mandatory = $true)][ValidateSet('Start', 'Stop', 'Status')][string]$Action,
    [Parameter(Mandatory = $true)][string]$DeploymentRoot,
    [Parameter(Mandatory = $true)][string]$Workspace,
    [string]$Distro = 'RaftLocal',
    [string]$ServiceHome = '/opt/raft',
    [string]$ServiceUser = 'raft',
    [string]$ProxyUrl
)

$ErrorActionPreference = 'Stop'
$DeploymentRoot = [IO.Path]::GetFullPath($DeploymentRoot)
$linuxRoot = (& wsl.exe -d $Distro -u root --exec wslpath -a -u $DeploymentRoot.Replace('\', '/') | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxRoot.StartsWith('/')) { throw 'Could not resolve the deployment directory in WSL' }
$linuxScripts = (& wsl.exe -d $Distro -u root --exec wslpath -a -u $PSScriptRoot.Replace('\', '/') | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxScripts.StartsWith('/')) { throw 'Could not resolve the script directory in WSL' }

function Invoke-LinuxService([string]$scriptName) {
    & wsl.exe -d $Distro -u root --exec bash "$linuxScripts/$scriptName" $linuxRoot $ServiceHome $ServiceUser
    if ($LASTEXITCODE -ne 0) { throw "WSL service command failed: $scriptName" }
}

if ($Action -eq 'Stop') {
    if (Test-Path -LiteralPath (Join-Path $DeploymentRoot 'windows\data\computer\run\service.pid')) {
        & "$PSScriptRoot\computer.ps1" -DeploymentRoot $DeploymentRoot -Command @('stop') -ProxyUrl $ProxyUrl
    }
    Invoke-LinuxService 'wsl-stop.sh'
} elseif ($Action -eq 'Start') {
    Invoke-LinuxService 'wsl-start.sh'
    & "$PSScriptRoot\computer.ps1" -DeploymentRoot $DeploymentRoot -Command @('start', "/$($Workspace.TrimStart('/'))") -ProxyUrl $ProxyUrl
} else {
    Invoke-LinuxService 'wsl-status.sh'
    & "$PSScriptRoot\computer.ps1" -DeploymentRoot $DeploymentRoot -Command @('status', "/$($Workspace.TrimStart('/'))") -ProxyUrl $ProxyUrl
}
