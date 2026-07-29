import { pathToFileURL } from "node:url";

import { checkDeployment } from "./lib/deployment-health.mjs";

export async function runDeploymentCheck({
  check = checkDeployment,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const result = await check();
    stdout.write(
      `Deployment healthy: ${result.hostname} ${result.endpoints.join(" ")}\n`
    );
    return 0;
  } catch (error) {
    stderr.write(`Deployment unhealthy: ${error?.message || error}\n`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runDeploymentCheck();
}
