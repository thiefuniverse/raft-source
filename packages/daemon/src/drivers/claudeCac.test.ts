import { spawn } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { discoverClaudeCacEnvironments, prepareClaudeCacLaunch } from "./claudeCac";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const homeDir = mkdtempSync(path.join(os.tmpdir(), "raft-cac-test-"));
  roots.push(homeDir);
  const root = path.join(homeDir, ".cac");
  for (const directory of ["bin", "shim-bin", "versions/1.2.3", "envs/alpha/.claude", "envs/beta/.claude"]) mkdirSync(path.join(root, directory), { recursive: true });
  writeFileSync(path.join(root, "current"), "beta");
  // A synthetic wrapper implements the supported layout; no real CAC state or
  // Claude binary is ever used by these tests.
  writeFileSync(path.join(root, "bin", "claude"), `#!/usr/bin/env bash
set -euo pipefail
# CAC_WRAPPER_VER=1.5.7
CAC_DIR="$HOME/.cac"
_name=$(cat "$CAC_DIR/current")
_env_dir="$CAC_DIR/envs/$_name"
export CLAUDE_CONFIG_DIR="$_env_dir/.claude"
export HTTPS_PROXY=$(cat "$_env_dir/proxy")
export NO_PROXY=localhost,127.0.0.1
export FIXTURE_HOSTNAME=$("$CAC_DIR/shim-bin/hostname")
_ver=$(cat "$_env_dir/version")
_real="$CAC_DIR/versions/$_ver/claude"
"$_real.exe" "$FIXTURE_SCRIPT" "$@"
`);
  writeFileSync(path.join(root, "shim-bin", "hostname"), `#!/usr/bin/env bash
CAC_DIR="$HOME/.cac"
cat "$CAC_DIR/envs/$(cat "$CAC_DIR/current")/hostname"
`, { mode: 0o700 });
  for (const [name, model, proxy] of [["alpha", "opus", "http://127.0.0.1:18001"], ["beta", "sonnet", "http://127.0.0.1:18002"]]) {
    const directory = path.join(root, "envs", name);
    writeFileSync(path.join(directory, ".claude", "settings.json"), JSON.stringify({ model }));
    writeFileSync(path.join(directory, ".claude", ".credentials.json"), "fixture-secret-not-to-be-copied");
    writeFileSync(path.join(directory, "version"), "1.2.3");
    writeFileSync(path.join(directory, "proxy"), proxy);
    writeFileSync(path.join(directory, "hostname"), `fixture-${name}`);
  }
  const binary = path.join(root, "versions", "1.2.3", "claude.exe");
  try { linkSync(process.execPath, binary); } catch { copyFileSync(process.execPath, binary); }
  const script = path.join(homeDir, "echo.cjs");
  writeFileSync(script, `const fs=require('node:fs'); let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{const settings=JSON.parse(fs.readFileSync(process.env.CLAUDE_CONFIG_DIR+'/settings.json','utf8')); console.log(JSON.stringify({args:process.argv.slice(2),input,model:settings.model,proxy:process.env.HTTPS_PROXY,hostname:process.env.FIXTURE_HOSTNAME,home:process.env.HOME,noProxy:process.env.NO_PROXY})); process.exitCode=7;});`);
  const bashPath = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  // Linux exercises the same static bootstrap and file binding. Windows runs
  // through real Git Bash + native Node, covering MSYS' argv boundary as well.
  if (process.platform !== "win32") writeFileSync(path.join(root, "bin", "cygpath"), '#!/bin/sh\nprintf "%s\\n" "$2"\n', { mode: 0o700 });
  const deps = { platform: "win32" as const, homeDir, bashPath };
  const env = { ...process.env, HOME: homeDir, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}`, FIXTURE_SCRIPT: script };
  return { root, homeDir, deps, env, options: { stateDirectory: path.join(homeDir, "raft"), env } };
}

test("discovery exposes only names/model/version and reads no global current", () => {
  const f = fixture();
  rmSync(path.join(f.root, "current"));
  expect(discoverClaudeCacEnvironments(f.deps)).toEqual({ kind: "live", environments: [
    { name: "alpha", model: "opus", version: "1.2.3" }, { name: "beta", model: "sonnet", version: "1.2.3" },
  ] });
  expect(discoverClaudeCacEnvironments({ ...f.deps, platform: "linux" })).toEqual({ kind: "unavailable", reason: "unsupported" });
  expect(discoverClaudeCacEnvironments({ ...f.deps, homeDir: path.join(f.homeDir, "absent") })).toEqual({ kind: "unavailable", reason: "missing_config" });
});

test.each(["missing proxy", "empty proxy", "disabled", "missing version", "incompatible wrapper", "invalid settings"])("fails closed for %s", (condition) => {
  const f = fixture();
  if (condition === "missing proxy") rmSync(path.join(f.root, "envs/alpha/proxy"));
  if (condition === "empty proxy") writeFileSync(path.join(f.root, "envs/alpha/proxy"), " \n");
  if (condition === "disabled") writeFileSync(path.join(f.root, "stopped"), "");
  if (condition === "missing version") rmSync(path.join(f.root, "envs/alpha/version"));
  if (condition === "incompatible wrapper") writeFileSync(path.join(f.root, "bin/claude"), "#!/bin/bash\nexec claude");
  if (condition === "invalid settings") writeFileSync(path.join(f.root, "envs/alpha/.claude/settings.json"), "null");
  expect(() => prepareClaudeCacLaunch("alpha", [], f.options, f.deps)).toThrow(/^CAC:/);
  expect(readFileSync(path.join(f.root, "current"), "utf8")).toBe("beta");
});

test("rejects traversal and per-agent proxy/config overrides", () => {
  const f = fixture();
  expect(() => prepareClaudeCacLaunch("../alpha", [], f.options, f.deps)).toThrow();
  expect(() => prepareClaudeCacLaunch("alpha", [], { ...f.options, agentEnv: { https_proxy: "http://other" } }, f.deps)).toThrow();
});

test("CAC clears inherited Claude provider/login/model controls but retains tool settings", () => {
  const f = fixture();
  const launch = prepareClaudeCacLaunch("alpha", [], { ...f.options, env: { ...f.env,
    CLAUDE_CODE_OAUTH_TOKEN: "other-login", CLAUDE_CODE_USE_VERTEX: "1", ANTHROPIC_MODEL: "other-model",
    AWS_ACCESS_KEY_ID: "tool-key", HTTPS_PROXY: "http://tool-proxy", CUSTOM_TOOL_SETTING: "keep",
  } }, f.deps);
  expect(launch.env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
  expect(launch.env).not.toHaveProperty("CLAUDE_CODE_USE_VERTEX");
  expect(launch.env).not.toHaveProperty("ANTHROPIC_MODEL");
  expect(launch.env).toMatchObject({ AWS_ACCESS_KEY_ID: "tool-key", HTTPS_PROXY: "http://tool-proxy", CUSTOM_TOOL_SETTING: "keep" });
  launch.cleanup();
});

test("two pinned environments preserve config, model, proxy, argv, stdin, stdout and exit without changing current", async () => {
  const f = fixture();
  const args = ["", "*", "中文 空格", '{"value":"a b","wildcard":"*"}', "first\nsecond", "quote'\"and\\slash"];
  const launches = ["alpha", "beta"].map((name) => prepareClaudeCacLaunch(name, args, f.options, f.deps));
  writeFileSync(path.join(f.root, "current"), "alpha");
  const outputs = await Promise.all(launches.map((launch) => new Promise<{ code: number | null; result: Record<string, unknown> }>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, { env: launch.env, stdio: "pipe", shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => {
      try { expect(stderr).toBe(""); resolve({ code, result: JSON.parse(stdout) }); }
      catch (error) { reject(error); }
    });
    child.stdin.end("输入\nsecond line");
  })));
  for (const [index, output] of outputs.entries()) {
    expect(output.code).toBe(7);
    expect(output.result).toMatchObject({ args, input: "输入\nsecond line", home: f.homeDir, noProxy: "localhost,127.0.0.1" });
    expect(output.result.model).toBe(index === 0 ? "opus" : "sonnet");
    expect(output.result.proxy).toBe(`http://127.0.0.1:${index === 0 ? 18001 : 18002}`);
    expect(output.result.hostname).toBe(index === 0 ? "fixture-alpha" : "fixture-beta");
  }
  for (const launch of launches) launch.cleanup();
  expect(readFileSync(path.join(f.root, "current"), "utf8")).toBe("alpha");
  expect(readFileSync(path.join(f.root, "envs/alpha/.claude/.credentials.json"), "utf8")).toBe("fixture-secret-not-to-be-copied");
  expect(existsSync(path.join(f.root, "envs/beta/.claude/settings.json"))).toBe(true);
});
