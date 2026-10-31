import { expect, test } from "vitest";
import { CLAUDE_CAC_INHERITED_MODEL, parseRuntimeConfig } from "@botiverse/raft-shared";
import { applyRuntimeFormV2Change, initialRuntimeFormV2Values, parseRuntimeFormV2, runtimeFormV2Submission, validateRuntimeFormV2 } from "@botiverse/raft-runtime-form";
import { buildRuntimeConfigFromFormValues, buildRuntimeFormV2, buildRuntimeFormV2EditBody, runtimeFormV2Entry, type RuntimeFormOptionSourceContext } from "./runtimeFormV2Registry";

const context = (detect?: RuntimeFormOptionSourceContext["agentOrchestrator"]["detectMachineClaudeCacEnvironments"]): RuntimeFormOptionSourceContext => ({
  sourceId: "cacEnvironment", machineId: "fixture-computer", machine: {}, refresh: true,
  routeToComputer: async () => "confirmed_local",
  agentOrchestrator: {
    detectMachineRuntimeModels: async () => ({ kind: "unsupported" }),
    detectMachineRuntimeModelsWithAuthority: async () => { throw new Error("unused"); },
    ...(detect ? { detectMachineClaudeCacEnvironments: detect } : {}),
  },
});

test("CAC option source queries the Computer each refresh and exposes only environment summaries", async () => {
  let calls = 0;
  const ctx = context(async () => { calls++; return { kind: "live", environments: [{ name: "work", version: "1.2.3", model: "opus" }] }; });
  const result = await runtimeFormV2Entry("claude")!.resolveOptionSource(ctx);
  expect(result).toMatchObject({ kind: "source", source: { status: "live", customValueAllowed: false, options: [
    { value: "", label: "Default Claude" }, { value: "work", label: "CAC: work · opus · Claude 1.2.3" },
  ] } });
  await runtimeFormV2Entry("claude")!.resolveOptionSource(ctx);
  expect(calls).toBe(2);
});

test.each([undefined, async () => ({ kind: "unavailable" as const, reason: "missing_config" as const })])("old Computer or missing CAC keeps ordinary Claude selectable", async (detect) => {
  const result = await runtimeFormV2Entry("claude")!.resolveOptionSource(context(detect));
  expect(result).toMatchObject({ kind: "source", source: { status: "fallback", options: [{ value: "", label: "Default Claude" }] } });
});

test("CAC selection creates inherited config, hides overrides and round trips through edit", () => {
  const built = buildRuntimeConfigFromFormValues("claude", { cacEnvironment: "work", envVars: { TOOL_OPTION: "keep" } });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const parsed = parseRuntimeConfig({ runtimeConfig: built.runtimeConfig });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.config.model).toEqual({ kind: "custom", name: CLAUDE_CAC_INHERITED_MODEL });
  const edit = buildRuntimeFormV2EditBody("claude", parsed.config)!;
  expect(edit.values?.cacEnvironment).toBe("work");
  const form = parseRuntimeFormV2(edit);
  expect(form).not.toBeNull();
  if (!form) return;
  const source = { protocolVersion: 2, runtimeId: "claude", schemaVersion: "1", sourceId: "cacEnvironment", kind: "select" as const, pointer: "/cacEnvironment", options: [{ value: "", label: "Default Claude" }, { value: "work", label: "CAC: work" }] };
  const sources = { cacEnvironment: source };
  const values = initialRuntimeFormV2Values(form, sources);
  expect(validateRuntimeFormV2(form, sources, values)).toEqual({});
  expect(runtimeFormV2Submission(form, values, sources)).toEqual({ cacEnvironment: "work", envVars: { TOOL_OPTION: "keep" } });
  expect(validateRuntimeFormV2(form, { cacEnvironment: { ...source, options: [source.options[0]!] } }, values)).toEqual({ cacEnvironment: "not_a_choice" });
  expect(buildRuntimeConfigFromFormValues("claude", runtimeFormV2Submission(form, values, sources))).toMatchObject({ ok: true, runtimeConfig: parsed.config });
  const plainValues = applyRuntimeFormV2Change(form, sources, values, "cacEnvironment", "");
  const plain = buildRuntimeConfigFromFormValues("claude", runtimeFormV2Submission(form, plainValues, sources));
  expect(plain.ok).toBe(true);
  if (plain.ok) {
    expect(plain.runtimeConfig).not.toHaveProperty("cacEnvironment");
    expect(plain.runtimeConfig.model).not.toEqual({ kind: "custom", name: CLAUDE_CAC_INHERITED_MODEL });
    expect(parseRuntimeConfig({ runtimeConfig: plain.runtimeConfig }).ok).toBe(true);
  }
});

test("plain Claude form remains available with the new optional source", () => {
  expect(buildRuntimeFormV2("claude").dataSchema.required).toEqual(["provider", "model"]);
  expect(buildRuntimeConfigFromFormValues("claude", { provider: "default", model: "sonnet", command: "existing-wrapper" })).toMatchObject({ ok: true, runtimeConfig: { command: "existing-wrapper" } });
});

test("switching ordinary Claude to CAC drops its hidden command/provider/model overrides", () => {
  const form = parseRuntimeFormV2(buildRuntimeFormV2("claude"))!;
  const values = applyRuntimeFormV2Change(form, {}, {
    cacEnvironment: "", provider: "custom", apiUrl: "https://example.test", apiKey: "fixture-key",
    model: "sonnet", reasoningEffort: "high", fastMode: true, command: "existing-wrapper", envVars: {},
  }, "cacEnvironment", "work");
  const submission = runtimeFormV2Submission(form, values, {});
  expect(submission).toEqual({ cacEnvironment: "work", envVars: {} });
  const built = buildRuntimeConfigFromFormValues("claude", submission);
  expect(built.ok).toBe(true);
  if (built.ok) expect(parseRuntimeConfig({ runtimeConfig: built.runtimeConfig }).ok).toBe(true);
});
