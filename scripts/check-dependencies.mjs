import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { retry } from "./lib/retry.mjs";

const execFileAsync = promisify(execFile);
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

async function execute(command, args) {
  const { stdout, stderr } = await execFileAsync(command, args);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
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
  runCommand = execute,
  sleep,
} = {}) {
  await runCommand("npm", TREE_ARGS);
  await retry(() => runCommand("npm", AUDIT_ARGS), {
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
    if (error?.stdout) process.stdout.write(error.stdout);
    if (error?.stderr) process.stderr.write(error.stderr);
    if (!error?.stdout && !error?.stderr) {
      console.error(error?.message || error);
    }
    process.exitCode = Number.isInteger(error?.code) ? error.code : 1;
  }
}
