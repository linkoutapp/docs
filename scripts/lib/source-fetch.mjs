import { retry } from "./retry.mjs";

const DEFAULT_BASE_URL =
  "https://raw.githubusercontent.com/linkoutapp/linkout-scraper/main";
const DEFAULT_TIMEOUT_MS = 15_000;
const NETWORK_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function diagnostic(path, message) {
  return `${path}: ${message}`;
}

function isNetworkOrTimeoutError(error) {
  return (
    error instanceof TypeError ||
    error?.name === "AbortError" ||
    error?.name === "TimeoutError" ||
    NETWORK_ERROR_CODES.has(error?.code)
  );
}

export async function fetchSourceText(
  path,
  {
    baseUrl = DEFAULT_BASE_URL,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    timeoutSignal = AbortSignal.timeout,
    sleep,
  } = {}
) {
  try {
    return await retry(
      async () => {
        const response = await fetchImpl(`${baseUrl}/${path}`, {
          signal: timeoutSignal(timeoutMs),
        });
        if (
          typeof response?.ok !== "boolean" ||
          typeof response?.status !== "number" ||
          typeof response?.text !== "function"
        ) {
          throw new Error(diagnostic(path, "fetch returned a malformed response"));
        }
        if (!response.ok) {
          throw Object.assign(new Error(`HTTP ${response.status}`), {
            status: response.status,
          });
        }
        return await response.text();
      },
      {
        isRetryableError: isNetworkOrTimeoutError,
        ...(sleep ? { sleep } : {}),
      }
    );
  } catch (error) {
    if (error?.message?.startsWith(`${path}:`)) throw error;
    if (typeof error?.status === "number") {
      throw new Error(diagnostic(path, `fetch returned HTTP ${error.status}`), {
        cause: error,
      });
    }
    throw new Error(
      diagnostic(path, `fetch failed (${error?.code || error?.message})`),
      { cause: error }
    );
  }
}
