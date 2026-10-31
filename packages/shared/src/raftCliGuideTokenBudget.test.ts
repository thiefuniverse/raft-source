import { expect, test } from "vitest";
import { buildRaftCliGuideSections } from "./raftCliGuide";

const identity = { handle: "alice", displayName: "Alice" };

test("managed command discovery stays compact while full syntax remains in the manual", () => {
  const managed = buildRaftCliGuideSections({ audience: "managed-runner", identity });
  const manual = buildRaftCliGuideSections({ audience: "self-hosted-runner", identity });

  expect(Buffer.byteLength(managed.communication)).toBeLessThan(3_600);
  for (const command of ["raft message", "raft inbox check", "raft task", "raft manual get", "raft manual search", "raft integration list", "raft user info", "raft auth whoami"]) {
    expect(managed.communication).toContain(command);
  }
  for (const guidance of ["--help", "--intent", "--reason", "credentials", "older", "not \"unavailable\""]) {
    expect(managed.communication).toContain(guidance);
  }
  for (const command of ["raft task amend", "raft channel archive", "raft mention notify", "raft action prepare"]) {
    expect(manual.communication).toContain(command);
  }
});

test("managed memory guidance omits the template and keeps recovery and size rules", () => {
  const managed = buildRaftCliGuideSections({ audience: "managed-runner", identity, memoryIndexBudgetBytes: 16_384 });
  const manual = buildRaftCliGuideSections({ audience: "self-hosted-runner", identity });

  expect(Buffer.byteLength(managed.workspaceAndMemory)).toBeLessThan(1_400);
  expect(managed.workspaceAndMemory).toContain("16 KB or less");
  expect(managed.workspaceAndMemory).toContain("notes/");
  expect(managed.workspaceAndMemory).toContain("user preferences");
  expect(managed.compactionSafety).toContain("recovery point");
  expect(managed.workspaceAndMemory).not.toContain("# <Your Name>");
  expect(manual.workspaceAndMemory).toContain("# <Your Name>");
});

test("managed discovery keeps pagination, membership and privacy boundaries", () => {
  const { discovery } = buildRaftCliGuideSections({ audience: "managed-runner", identity });

  expect(Buffer.byteLength(discovery)).toBeLessThan(1_400);
  for (const guidance of ["raft server info --channels", "--offset", "pages", "joined=false", "raft channel join", "raft channel mute", "raft thread unfollow", "private", "owner/admin"]) {
    expect(discovery).toContain(guidance);
  }
});
