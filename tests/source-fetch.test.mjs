import assert from "node:assert/strict";
import test from "node:test";

import { fetchSourceText } from "../scripts/lib/source-fetch.mjs";

function response(status, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

test("retries a transient source response and returns its eventual body", async () => {
  let attempts = 0;

  const body = await fetchSourceText("README.md", {
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1 ? response(503) : response(200, "contents");
    },
    sleep: async () => {},
  });

  assert.equal(body, "contents");
  assert.equal(attempts, 2);
});

test("reports a permanent source response without retrying", async () => {
  let attempts = 0;

  await assert.rejects(
    fetchSourceText("missing.md", {
      fetchImpl: async () => {
        attempts += 1;
        return response(404);
      },
      sleep: async () => {},
    }),
    /missing\.md: fetch returned HTTP 404/
  );
  assert.equal(attempts, 1);
});

test("retries thrown network failures with per-file diagnostics", async () => {
  let attempts = 0;

  await assert.rejects(
    fetchSourceText("package.json", {
      fetchImpl: async () => {
        attempts += 1;
        throw new TypeError("fetch failed");
      },
      sleep: async () => {},
    }),
    /package\.json: fetch failed \(fetch failed\)/
  );
  assert.equal(attempts, 3);
});

test("fails clearly when fetch returns a malformed response", async () => {
  await assert.rejects(
    fetchSourceText("README.md", {
      fetchImpl: async () => ({ ok: true }),
      sleep: async () => {},
    }),
    /README\.md: fetch returned a malformed response/
  );
});

test("preserves the 15 second timeout for every attempt", async () => {
  let attempts = 0;
  const signals = [];
  const timeoutCalls = [];

  await fetchSourceText("README.md", {
    fetchImpl: async (_url, options) => {
      signals.push(options.signal);
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return response(200);
    },
    timeoutSignal: (timeoutMs) => {
      timeoutCalls.push(timeoutMs);
      return { timeoutMs };
    },
    sleep: async () => {},
  });

  assert.deepEqual(timeoutCalls, [15_000, 15_000]);
  assert.notEqual(signals[0], signals[1]);
});
