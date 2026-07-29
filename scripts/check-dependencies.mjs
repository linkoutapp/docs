import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { retry } from "./lib/retry.mjs";

const COMMAND_TIMEOUT_MS = 15_000;
const OUTPUT_TAIL_LIMIT = 64 * 1024;
const TREE_ARGS = [
  "ls",
  "brace-expansion",
  "serialize-javascript",
  "uuid",
  "--all",
  "--silent",
];
const AUDIT_ARGS = ["audit", "--omit=dev"];
const NETWORK_ERROR_PATTERN =
  /\b(?:EAI_AGAIN|ECONNRESET|ECONNREFUSED|ENETUNREACH|ENOTFOUND|ETIMEDOUT|ESOCKETTIMEDOUT)\b|socket hang up|fetch failed/i;
const TRANSIENT_HTTP_PATTERN =
  /\b(?:(?:HTTP|status)(?:\s+(?:status|code))?|npm error)\s*[:=]?\s*(?:408|429|5\d\d)\b|\bE5\d\d\b/i;

function appendTail(current, chunk) {
  return `${current}${chunk}`.slice(-OUTPUT_TAIL_LIMIT);
}

function commandError(args, code, signal, stdout, stderr, timeoutMs) {
  const detail =
    code === "ETIMEDOUT"
      ? `timed out after ${timeoutMs}ms`
      : `exited with ${signal ? `signal ${signal}` : `code ${code}`}`;
  return Object.assign(new Error(`npm ${args.join(" ")} ${detail}`), {
    code,
    signal,
    stdout,
    stderr,
  });
}

function npmInvocation(
  args,
  { environment, nodeExecutable, platform }
) {
  if (environment.npm_execpath) {
    return {
      args: [environment.npm_execpath, ...args],
      executable: nodeExecutable,
    };
  }
  if (platform !== "win32") {
    return { args, executable: "npm" };
  }

  throw new Error(
    "npm_execpath is required on Windows; run this checker through npm"
  );
}

export function createNpmRunner({
  environment = process.env,
  nodeExecutable = process.execPath,
  platform = process.platform,
  spawnImpl = spawn,
  timeoutMs = COMMAND_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  return (npmArgs) => {
    const invocation = npmInvocation(npmArgs, {
      environment,
      nodeExecutable,
      platform,
    });

    return new Promise((resolve, reject) => {
      const child = spawnImpl(invocation.executable, invocation.args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdoutTail = "";
      let stderrTail = "";
      let settled = false;
      let timedOut = false;

      child.stdout.on("data", (chunk) => {
        stdout.write(chunk);
        stdoutTail = appendTail(stdoutTail, chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr.write(chunk);
        stderrTail = appendTail(stderrTail, chunk);
      });

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        callback(value);
      };
      const timer = setTimer(() => {
        if (settled) return;
        timedOut = true;
        try {
          if (!child.kill("SIGKILL")) {
            finish(
              reject,
              commandError(
                npmArgs,
                "ETIMEDOUT",
                null,
                stdoutTail,
                stderrTail,
                timeoutMs
              )
            );
          }
        } catch {
          finish(
            reject,
            commandError(
              npmArgs,
              "ETIMEDOUT",
              null,
              stdoutTail,
              stderrTail,
              timeoutMs
            )
          );
        }
      }, timeoutMs);

      child.once("error", (error) => {
        Object.assign(error, { stdout: stdoutTail, stderr: stderrTail });
        finish(reject, error);
      });
      child.once("close", (code, signal) => {
        if (timedOut) {
          finish(
            reject,
            commandError(
              npmArgs,
              "ETIMEDOUT",
              signal,
              stdoutTail,
              stderrTail,
              timeoutMs
            )
          );
        } else if (code === 0) {
          finish(resolve);
        } else {
          finish(
            reject,
            commandError(
              npmArgs,
              code,
              signal,
              stdoutTail,
              stderrTail,
              timeoutMs
            )
          );
        }
      });
    });
  };
}

function isTransientNpmFailure(error) {
  const output = [error?.code, error?.message, error?.stdout, error?.stderr]
    .filter(Boolean)
    .join("\n");
  return (
    NETWORK_ERROR_PATTERN.test(output) || TRANSIENT_HTTP_PATTERN.test(output)
  );
}

export async function runDependencyChecks({
  runCommand,
  runnerOptions,
  sleep,
} = {}) {
  const execute = runCommand
    ? (args) => runCommand("npm", args)
    : createNpmRunner(runnerOptions);
  await execute(TREE_ARGS);
  await retry(() => execute(AUDIT_ARGS), {
    isRetryableError: isTransientNpmFailure,
    ...(sleep ? { sleep } : {}),
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runDependencyChecks();
  } catch (error) {
    if (!error?.stdout && !error?.stderr) {
      console.error(error?.message || error);
    }
    process.exitCode = Number.isInteger(error?.code) ? error.code : 1;
  }
}
