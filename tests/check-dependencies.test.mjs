import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  createNpmRunner,
  runDependencyChecks,
} from "../scripts/check-dependencies.mjs";

function fakeChild({ code = 0, stderr = "", stdout = "" } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  queueMicrotask(() => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.emit("close", code, null);
  });
  return child;
}

for (const platform of ["darwin", "win32"]) {
  test(`real launcher uses Node and npm_execpath on ${platform}`, async () => {
    const launches = [];
    const runCommand = createNpmRunner({
      environment: { npm_execpath: "/opt/npm/bin/npm-cli.js" },
      nodeExecutable: "/opt/node/bin/node",
      platform,
      spawnImpl: (command, args, options) => {
        launches.push({ command, args, options });
        return fakeChild();
      },
      stderr: { write() {} },
      stdout: { write() {} },
    });

    await runCommand(["audit", "--omit=dev"]);

    assert.deepEqual(launches, [
      {
        command: "/opt/node/bin/node",
        args: ["/opt/npm/bin/npm-cli.js", "audit", "--omit=dev"],
        options: {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      },
    ]);
  });
}

test("real launcher falls back to the npm executable on POSIX", async () => {
  const launches = [];
  const runCommand = createNpmRunner({
    environment: {},
    platform: "linux",
    spawnImpl: (command, args, options) => {
      launches.push({ command, args, options });
      return fakeChild();
    },
    stderr: { write() {} },
    stdout: { write() {} },
  });

  await runCommand(["audit", "--omit=dev"]);

  assert.deepEqual(launches, [
    {
      command: "npm",
      args: ["audit", "--omit=dev"],
      options: {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    },
  ]);
});

test("Windows without npm_execpath fails immediately without spawning", () => {
  let spawnCalls = 0;
  const runCommand = createNpmRunner({
    environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    platform: "win32",
    spawnImpl: () => {
      spawnCalls += 1;
      return fakeChild();
    },
  });

  assert.throws(
    () => runCommand(["audit", "--omit=dev"]),
    /npm_execpath is required on Windows/
  );
  assert.equal(spawnCalls, 0);
});

test("real launcher kills and retries a stalled audit attempt", async () => {
  let auditAttempts = 0;
  const launches = [];
  const killed = [];
  const timeoutCalls = [];

  await runDependencyChecks({
    runnerOptions: {
      environment: {},
      platform: "linux",
      spawnImpl: (_command, args) => {
        launches.push(args);
        if (args[0] !== "audit") {
          return fakeChild();
        }
        auditAttempts += 1;
        if (auditAttempts > 1) return fakeChild();

        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = (signal) => {
          killed.push(signal);
          queueMicrotask(() => child.emit("close", null, signal));
          return true;
        };
        return child;
      },
      setTimer: (callback, timeoutMs) => {
        timeoutCalls.push(timeoutMs);
        const timer = { active: true };
        queueMicrotask(() => {
          if (timer.active) callback();
        });
        return timer;
      },
      clearTimer(timer) {
        timer.active = false;
      },
      stderr: { write() {} },
      stdout: { write() {} },
    },
    sleep: async () => {},
  });

  assert.deepEqual(
    launches.map((args) => args[0]),
    ["ls", "audit", "audit"]
  );
  assert.deepEqual(killed, ["SIGKILL"]);
  assert.deepEqual(timeoutCalls, [15_000, 15_000, 15_000]);
});

test("real launcher preserves subprocess output and nonzero exit code", async () => {
  const written = { stderr: "", stdout: "" };
  const runCommand = createNpmRunner({
    environment: {},
    spawnImpl: () =>
      fakeChild({
        code: 1,
        stdout: "audit report\n",
        stderr: "vulnerabilities found\n",
      }),
    stderr: { write: (chunk) => (written.stderr += chunk) },
    stdout: { write: (chunk) => (written.stdout += chunk) },
  });

  await assert.rejects(runCommand(["audit", "--omit=dev"]), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, "audit report\n");
    assert.equal(error.stderr, "vulnerabilities found\n");
    return true;
  });
  assert.deepEqual(written, {
    stdout: "audit report\n",
    stderr: "vulnerabilities found\n",
  });
});

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
