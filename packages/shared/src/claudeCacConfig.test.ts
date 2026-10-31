import { expect, test } from "vitest";
import { CLAUDE_CAC_INHERITED_MODEL, hydrateRuntimeConfig, parseRuntimeConfig, runtimeConfigToLaunchFields } from "./index";

const cac = {
  version: 1, runtime: "claude", cacEnvironment: "work-env",
  provider: { kind: "default" }, model: { kind: "custom", name: CLAUDE_CAC_INHERITED_MODEL },
  mode: { kind: "default" }, reasoningEffort: null, envVars: { TOOL_OPTION: "keep" },
};

test("CAC config survives strict write, stored hydration and launch projection without a model env override", () => {
  const parsed = parseRuntimeConfig({ runtimeConfig: cac });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const hydrated = hydrateRuntimeConfig({ runtimeConfig: parsed.config });
  expect(hydrated).toEqual(cac);
  expect(runtimeConfigToLaunchFields(hydrated)).toMatchObject({
    cacEnvironment: "work-env", model: CLAUDE_CAC_INHERITED_MODEL, envVars: { TOOL_OPTION: "keep" },
  });
});

test.each([
  { cacEnvironment: "../escape" }, { runtime: "codex" }, { command: "claude" },
  { provider: { kind: "custom", apiUrl: "https://example.test", apiKey: "fixture" } },
  { model: { kind: "preset", id: "sonnet" } }, { mode: { kind: "fast" } }, { reasoningEffort: "high" },
  { envVars: { HOME: "elsewhere" } }, { envVars: { HTTP_PROXY: "http://elsewhere" } },
  { envVars: { ANTHROPIC_MODEL: "sonnet" } },
  { envVars: { CLAUDE_CODE_OAUTH_TOKEN: "fixture" } },
  { envVars: { CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3" } },
  { envVars: { CLAUDE_CODE_USE_BEDROCK: "1" } },
])("CAC rejects contradictory fields %j", (override) => {
  expect(parseRuntimeConfig({ runtimeConfig: { ...cac, ...override } }).ok).toBe(false);
});

test("ordinary Claude still accepts command, model and provider configuration with no CAC field", () => {
  const { cacEnvironment: _, ...plain } = cac;
  const parsed = parseRuntimeConfig({ runtimeConfig: { ...plain, command: "my-claude", model: { kind: "preset", id: "sonnet" } } });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(runtimeConfigToLaunchFields(parsed.config)).toMatchObject({ command: "my-claude", model: "sonnet" });
});
