const DEFAULT_DELAYS_MS = [250, 1_000];

function isTransientHttpStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export async function retry(
  operation,
  {
    isRetryableError = () => false,
    sleep = (delayMs) =>
      new Promise((resolve) => setTimeout(resolve, delayMs)),
    delays = DEFAULT_DELAYS_MS,
  } = {}
) {
  const attempts = delays.length + 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const canRetry =
        isTransientHttpStatus(error?.status) || isRetryableError(error);
      if (!canRetry || attempt === attempts - 1) throw error;
      await sleep(delays[attempt]);
    }
  }
}
