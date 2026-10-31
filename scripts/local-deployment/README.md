# Local Windows + WSL deployment

The web/API and databases run in a dedicated WSL distribution. Raft Computer
runs as the signed-in Windows user, so it can discover that user's existing
Codex CLI and Windows development tools. Windows x64 Computer is experimental.

These helpers manage an initialized deployment. Prepare Node/pnpm, Docker,
Compose, nginx, tmux, the `raft` Linux service user and the application checkout
at `/opt/raft/app` first. Install dependencies, run the documented database
migrations/index checks and RisingWave bootstrap, and build the web client with
`VITE_API_URL` set to the local URL. Build the agent CLI with the package build
command. Keep the application checkout on the WSL filesystem.

## Private runtime layout

Use a deployment directory such as the repository's ignored `.raft-local/`:

```text
<deployment>/config/compose.yaml
<deployment>/config/proxy.env                 # optional WSL-reachable proxy
<deployment>/logs/
<deployment>/windows/bin/raft-computer-win32-x64.exe
<deployment>/windows/bin/photon_rs_bg.wasm
<deployment>/windows/data/                   # Computer login, keys, agent files
/opt/raft/config/service.env                 # WSL-only server secrets, mode 0600
/opt/raft/data/                              # databases and uploads
```

Copy `compose.example.yaml` and `service.env.example` to the runtime paths and
generate fresh secret values. `DATABASE_URL` must use the same private password
as `POSTGRES_PASSWORD`. The provider credential key is a base64-encoded random
32-byte value. Restrict Windows Computer data to the current user and SYSTEM.
The WSL env file must be owned by `ServiceUser` (`raft` by default) as well as
mode 0600. That user needs read access to the application and write access to
its upload/data directories and the deployment's logs directory.
Configure Docker's data root in `/etc/docker/daemon.json`; Docker is started in
an independent session so its port proxies survive the launching terminal.

nginx should serve `packages/web/dist`, proxy the API to port 13601, and forward
WebSocket upgrades. Its proxy paths must include `/daemon/connect` as well as
`/api`, `/internal`, `/socket.io`, `/uploads`, `/share` and `/oidc`. `/health`
and `/livez` also go to the API. Bind the web listener and database ports to
loopback. Use the source web nginx configuration for static asset/manifest rules.

For a proxy, configure a WSL-reachable endpoint in the private `config/proxy.env`.
Pass a Windows-reachable endpoint with `-ProxyUrl` for Computer. Proxy credentials
belong in private configuration or the process environment.

## Windows Computer

Build the same source version as the server in the prepared WSL checkout:

```bash
cd /opt/raft/app
pnpm --filter @botiverse/raft-computer build
bash /path/to/repo/scripts/local-deployment/build-windows-computer.sh \
  /opt/raft/app /path/to/deployment/windows/bin /opt/raft/build/windows-sea
```

The cross-build helper checks the official Node archive checksum and handles
Windows ZIP extraction on Linux. Keep the WASM sidecar beside the EXE. On
Windows, check the emitted SHA-256 and run `--version`, `__build-versions`,
`__verify-bundled-oauth`, `__verify-bundled-kimi` and `__cli --version` before
connecting. Cross-build success alone does not run the Windows executable.

Before the first Computer login, start only the initialized web/API stack as
root in WSL, so the device approval page is reachable:

```bash
bash /path/to/repo/scripts/local-deployment/wsl-start.sh \
  /path/to/deployment /opt/raft raft
```

In PowerShell, log in and connect interactively, using your own workspace slug:

```powershell
$deployment = Join-Path $PWD '.raft-local'
$computer = '.\scripts\local-deployment\computer.ps1'
& $computer -DeploymentRoot $deployment -Command @('login', '--server-url', 'http://localhost:13600')
& $computer -DeploymentRoot $deployment -Command @('setup', '/example', '--server-url', 'http://localhost:13600')
```

For an existing Computer identity, stop its original process first and use the
product's `--machine` migration option with the ID from its settings. Disable
the old launch path before enabling the new one. The helpers run only the API
server in WSL; Computer owns agent execution on Windows. Use Computer's normal
login flow for the Windows user.

## Start, inspect, stop

```powershell
$service = '.\scripts\local-deployment\service.ps1'
& $service -Action Start -DeploymentRoot $deployment -Workspace example
& $service -Action Status -DeploymentRoot $deployment -Workspace example
& $service -Action Stop -DeploymentRoot $deployment -Workspace example
```

`-Distro`, `-ServiceHome` and `-ServiceUser` select an existing WSL installation.
Start checks database readiness, starts the API, waits for health, then starts
Windows Computer. Stop shuts Computer down before the API and databases.
Status prints service and Computer connectivity; use Computer's `doctor` command
for credential/preflight/runner checks.

Keep service env files, login/session files, keys, machine/workspace identifiers,
database dumps, uploads, backups, screenshots, logs and native build outputs in
the private runtime directory. Commit the templates and source changes only.
