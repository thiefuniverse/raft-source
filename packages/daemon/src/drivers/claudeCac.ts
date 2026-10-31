import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isClaudeCacEnvironmentName, isClaudeCacControlledEnvKey, type ClaudeCacEnvironment, type ClaudeCacEnvironmentOutcome } from "@botiverse/raft-shared";
import { ambientProcessEnv } from "../processEnvPatch";
import type { DirectLaunch } from "./windowsLaunch";

interface CacDeps {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Test seam; production resolves Git Bash from its installation/PATH. */
  bashPath?: string;
}

const ROOT_ASSIGNMENT = /^CAC_DIR="\$HOME\/\.cac"\r?$/m;
const PUBLIC_FILES = ["cac-dns-guard.js", "fingerprint-hook.js", "relay.js", "blocked_hosts", "max_sessions"];
const fail = (reason: string): never => { throw new Error(`CAC: ${reason}`); };

function cacHome(deps: CacDeps): string {
  const env = deps.env ?? ambientProcessEnv();
  return path.resolve(deps.homeDir ?? env.HOME ?? env.USERPROFILE ?? os.homedir(), ".cac");
}

function gitBash(deps: CacDeps): string {
  if (deps.bashPath && existsSync(deps.bashPath)) return deps.bashPath;
  const env = deps.env ?? ambientProcessEnv();
  const candidates = [
    path.join(env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(env.LOCALAPPDATA ?? "", "Programs", "Git", "bin", "bash.exe"),
    ...(env.PATH ?? env.Path ?? "").split(";").flatMap((dir) => [
      path.join(dir, "bash.exe"), path.resolve(dir, "..", "bin", "bash.exe"),
    ]),
  ];
  // Do not select Windows' WSL bash.exe: it uses a different home/filesystem.
  return candidates.find((candidate) => /[\\/]Git[\\/]/i.test(candidate) && existsSync(candidate))
    ?? fail("Git Bash is required on this Computer");
}

function readText(filename: string): string {
  try { return readFileSync(filename, "utf8"); } catch { return fail("required local CAC file is unavailable"); }
}

function installation(deps: CacDeps): { root: string; bash: string; wrapper: string } {
  if ((deps.platform ?? process.platform) !== "win32") fail("named environments currently require Windows");
  const root = cacHome(deps);
  if (existsSync(path.join(root, "stopped"))) fail("CAC is disabled; enable it before using a CAC agent");
  const wrapper = readText(path.join(root, "bin", "claude"));
  // Only the layout we can pin without changing CAC's behavior is supported.
  if (!/^# CAC_WRAPPER_VER=1\.5\.7\r?$/m.test(wrapper) || !ROOT_ASSIGNMENT.test(wrapper)
    || !wrapper.includes('"$CAC_DIR/current"') || !wrapper.includes('"$CAC_DIR/versions/$_ver/claude"')) {
    fail("unsupported CAC wrapper layout (requires CAC 1.5.7)");
  }
  return { root, bash: gitBash(deps), wrapper };
}

function environment(root: string, name: string): ClaudeCacEnvironment {
  if (!isClaudeCacEnvironmentName(name)) fail("invalid environment name");
  const directory = path.join(root, "envs", name);
  if (!existsSync(path.join(directory, ".claude", "settings.json"))) fail("environment settings are missing");
  const proxy = readText(path.join(directory, "proxy")).trim();
  if (!/^(?:https?|socks5):\/\/\S+$/.test(proxy)) fail("environment requires a configured CAC proxy");
  const version = readText(path.join(directory, "version")).trim();
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9._-]+)?$/.test(version)
    || !existsSync(path.join(root, "versions", version, "claude.exe"))) fail("environment Claude version is not installed");
  let settings: Record<string, unknown>;
  try { settings = JSON.parse(readText(path.join(directory, ".claude", "settings.json"))); }
  catch { return fail("environment settings are invalid"); }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) fail("environment settings are invalid");
  // Never return the settings object, proxy URL or identity/auth files.
  const model = typeof settings.model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(settings.model)
    ? settings.model : undefined;
  return { name, version, ...(model ? { model } : {}) };
}

/** Filesystem-only discovery: does not launch Claude, contact a proxy or read credentials. */
export function discoverClaudeCacEnvironments(deps: CacDeps = {}): ClaudeCacEnvironmentOutcome {
  if ((deps.platform ?? process.platform) !== "win32") return { kind: "unavailable", reason: "unsupported" };
  if (!existsSync(path.join(cacHome(deps), "bin", "claude"))) return { kind: "unavailable", reason: "missing_config" };
  try {
    const { root } = installation(deps);
    const environments = readdirSync(path.join(root, "envs"), { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && isClaudeCacEnvironmentName(entry.name))
      .flatMap((entry) => {
        try { return [environment(root, entry.name)]; } catch { return []; }
      }).sort((a, b) => a.name.localeCompare(b.name));
    return { kind: "live", environments };
  } catch { return { kind: "unavailable", reason: "probe_failed" }; }
}

export function probeClaudeCacEnvironment(name: string, deps: CacDeps = {}): ClaudeCacEnvironment {
  return environment(installation(deps).root, name);
}

function pinRoot(script: string, view: string): string {
  if (!ROOT_ASSIGNMENT.test(script)) fail("unsupported CAC shim layout");
  // A literal Bash string, not a shell argument passed through Windows/MSYS.
  const literal = view.replace(/\\/g, "/").replace(/'/g, "'\\''");
  return script.replace(ROOT_ASSIGNMENT, () => `CAC_DIR='${literal}'`);
}

// Windows/MSYS can re-parse shell argv (globs, JSON and newlines). Only this
// static bootstrap is an argument; the actual argv is decoded as NUL records.
export const CLAUDE_CAC_BOOTSTRAP = `set -euo pipefail
_raft_view=$(cygpath -u "$RAFT_CAC_VIEW")
_raft_root=$(cygpath -u "$RAFT_CAC_ROOT")
[[ ! -f "$_raft_root/stopped" ]] || { echo 'CAC: CAC is disabled' >&2; exit 1; }
_raft_proxy=$(tr -d '[:space:]' < "$_raft_view/envs/$RAFT_CAC_ENVIRONMENT/proxy")
[[ "$_raft_proxy" =~ ^(http|https|socks5)://.+$ ]] || { echo 'CAC: proxy is missing' >&2; exit 1; }
unset _raft_proxy
_raft_args=()
while IFS= read -r -d '' _raft_arg; do _raft_args+=("$_raft_arg"); done < <(printf '%s' "$RAFT_CAC_ARGV" | base64 -d)
unset RAFT_CAC_ARGV
# CAC disowns its relay/watchdog. Their private pid files, not the jobs table,
# identify them. Stop the watchdog first so it cannot restart the relay.
_raft_cleanup() {
  set +e
  rm -f "$_raft_view/relay.proxy"
  for _raft_pid_file in relay.watchdog.pid relay.pid; do
    [[ -f "$_raft_view/$_raft_pid_file" ]] || continue
    _raft_pid=$(cat "$_raft_view/$_raft_pid_file" 2>/dev/null) || continue
    [[ "$_raft_pid" =~ ^[0-9]+$ ]] || continue
    if command -v taskkill.exe >/dev/null 2>&1; then
      if [[ "$_raft_pid_file" == relay.watchdog.pid ]]; then
        _raft_pid=$(ps -p "$_raft_pid" | awk 'NR==2 {print $4}') || continue
      fi
      [[ "$_raft_pid" =~ ^[0-9]+$ ]] || continue
      MSYS2_ARG_CONV_EXCL='*' taskkill.exe /PID "$_raft_pid" /T /F >/dev/null 2>&1 || true
    else
      kill "$_raft_pid" 2>/dev/null || true
    fi
  done
}
trap _raft_cleanup EXIT
source "$_raft_view/bin/claude" "\${_raft_args[@]}"
`;

export interface ClaudeCacLaunch extends DirectLaunch { cleanup(): void }

export function prepareClaudeCacLaunch(
  name: string,
  args: string[],
  options: { stateDirectory: string; env: NodeJS.ProcessEnv; agentEnv?: Record<string, string> | null },
  deps: CacDeps = {},
): ClaudeCacLaunch {
  // Agent env cannot relocate CAC, override the model, or disable its proxy.
  if (Object.keys(options.agentEnv ?? {}).some(isClaudeCacControlledEnvKey)) {
    fail("agent environment cannot override CAC configuration or proxy");
  }
  const { root, bash, wrapper } = installation(deps);
  environment(root, name);
  if (args.some((arg) => arg.includes("\0"))) fail("arguments must not contain null bytes");
  // One launch owns current + relay state. Original environment files remain
  // live through junctions, including credential refreshes; no login is copied.
  const parent = path.resolve(options.stateDirectory, "cac-launches");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const view = mkdtempSync(path.join(parent, `${createHash("sha256").update(name).digest("hex").slice(0, 12)}-`));
  const cleanup = () => {
    // The only recursive removal target is our own mkdtemp child. Node removes
    // junctions themselves, never their target environment/config directories.
    if (path.dirname(view) === parent) rmSync(view, { recursive: true, force: true });
  };
  try {
    mkdirSync(path.join(view, "bin"));
    mkdirSync(path.join(view, "envs"));
    mkdirSync(path.join(view, "shim-bin"));
    const link = (source: string, target: string) => symlinkSync(realpathSync(source), target, "junction");
    link(path.join(root, "envs", name), path.join(view, "envs", name));
    link(path.join(root, "versions"), path.join(view, "versions"));
    if (existsSync(path.join(root, "ca"))) link(path.join(root, "ca"), path.join(view, "ca"));
    writeFileSync(path.join(view, "current"), name, { mode: 0o600 });
    writeFileSync(path.join(view, "bin", "claude"), pinRoot(wrapper, view), { mode: 0o700 });
    const bootstrap = path.join(view, "bootstrap.sh");
    writeFileSync(bootstrap, CLAUDE_CAC_BOOTSTRAP, { mode: 0o700 });
    for (const entry of readdirSync(path.join(root, "shim-bin"))) {
      const source = path.join(root, "shim-bin", entry);
      if (!statSync(source).isFile()) fail("unsupported CAC shim layout");
      writeFileSync(path.join(view, "shim-bin", entry), pinRoot(readText(source), view), { mode: 0o700 });
    }
    for (const filename of PUBLIC_FILES) {
      const source = path.join(root, filename);
      if (existsSync(source)) writeFileSync(path.join(view, filename), readText(source), { mode: 0o600 });
    }
    const env = { ...options.env };
    // A daemon may itself have been started from another Claude/provider
    // session. CAC's selected login/model must win; tool credentials and
    // network settings are deliberately left alone.
    for (const key of Object.keys(env)) {
      if (/^(?:ANTHROPIC_|CLAUDE_CODE_(?:OAUTH_TOKEN|USE_|SKIP_.*_AUTH|EFFORT_LEVEL))/i.test(key)) delete env[key];
    }
    return {
      command: bash,
      args: ["--noprofile", "--norc", bootstrap.replace(/\\/g, "/")],
      env: {
        ...env,
        RAFT_CAC_VIEW: view,
        RAFT_CAC_ROOT: root,
        RAFT_CAC_ENVIRONMENT: name,
        RAFT_CAC_ARGV: Buffer.from(args.map((arg) => `${arg}\0`).join(""), "utf8").toString("base64"),
      },
      shell: false,
      cleanup,
    };
  } catch (error) {
    cleanup();
    if (error instanceof Error && error.message.startsWith("CAC:")) throw error;
    return fail("could not prepare the local CAC environment");
  }
}
