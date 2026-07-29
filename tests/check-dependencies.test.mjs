import assert from "node:assert/strict";
import test from "node:test";

import { runDependencyChecks } from "../scripts/check-dependencies.mjs";

test("validates the existing dependency tree before auditing production dependencies", async () => {
  const commands = [];

  await runDependencyChecks({
    runCommand: async (command, args) => commands.push([command, args]),
    sleep: async () => {},
  });

  assert.deepEqual(commands, [
    [
      "npm",
      ["ls", "brace-expansion", "serialize-javascript", "uuid", "--all", "--silent"],
    ],
    ["npm", ["audit", "--omit=dev"]],
  ]);
});

test("retries transient npm audit network failures", async () => {
  let auditAttempts = 0;

  await runDependencyChecks({
    runCommand: async (_command, args) => {
      if (args[0] !== "audit") return;
      auditAttempts += 1;
      if (auditAttempts < 3) {
        throw Object.assign(new Error("request to advisory endpoint failed"), {
          stderr: "npm error code ECONNRESET",
        });
      }
    },
    sleep: async () => {},
  });

  assert.equal(auditAttempts, 3);
});

test("retries transient npm audit DNS failures", async () => {
  let auditAttempts = 0;

  await runDependencyChecks({
    runCommand: async (_command, args) => {
      if (args[0] !== "audit") return;
      auditAttempts += 1;
      if (auditAttempts === 1) {
        throw Object.assign(new Error("advisory endpoint unavailable"), {
          stderr: "npm error code ENOTFOUND",
        });
      }
    },
    sleep: async () => {},
  });

  assert.equal(auditAttempts, 2);
});

test("does not retry an invalid dependency tree", async () => {
  let attempts = 0;
  const failure = Object.assign(new Error("invalid tree"), { exitCode: 1 });

  await assert.rejects(
    runDependencyChecks({
      runCommand: async () => {
        attempts += 1;
        throw failure;
      },
      sleep: async () => {},
    }),
    (error) => error === failure
  );
  assert.equal(attempts, 1);
});

test("does not retry audit failures caused by vulnerabilities", async () => {
  let auditAttempts = 0;
  const failure = Object.assign(new Error("vulnerabilities found"), {
    stdout: "3 high severity vulnerabilities",
  });

  await assert.rejects(
    runDependencyChecks({
      runCommand: async (_command, args) => {
        if (args[0] !== "audit") return;
        auditAttempts += 1;
        throw failure;
      },
      sleep: async () => {},
    }),
    (error) => error === failure
  );
  assert.equal(auditAttempts, 1);
});

test("does not mistake a vulnerability count for an HTTP failure", async () => {
  let auditAttempts = 0;
  const failure = Object.assign(new Error("vulnerabilities found"), {
    stdout: "500 vulnerabilities",
  });

  await assert.rejects(
    runDependencyChecks({
      runCommand: async (_command, args) => {
        if (args[0] !== "audit") return;
        auditAttempts += 1;
        throw failure;
      },
      sleep: async () => {},
    }),
    (error) => error === failure
  );
  assert.equal(auditAttempts, 1);
});

test("retries transient advisory HTTP failures", async () => {
  let auditAttempts = 0;

  await runDependencyChecks({
    runCommand: async (_command, args) => {
      if (args[0] !== "audit") return;
      auditAttempts += 1;
      if (auditAttempts === 1) {
        throw Object.assign(new Error("503 Service Unavailable"), {
          stderr: "npm error 503 Service Unavailable",
        });
      }
    },
    sleep: async () => {},
  });

  assert.equal(auditAttempts, 2);
});
