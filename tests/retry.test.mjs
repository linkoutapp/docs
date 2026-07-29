import assert from "node:assert/strict";
import test from "node:test";

import { retry } from "../scripts/lib/retry.mjs";

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

test("returns an eventual success within three attempts", async () => {
  let attempts = 0;

  const result = await retry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw httpError(503);
      return "ok";
    },
    { sleep: async () => {} }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("throws after three exhausted attempts", async () => {
  let attempts = 0;
  const failure = httpError(503);

  await assert.rejects(
    retry(
      async () => {
        attempts += 1;
        throw failure;
      },
      { sleep: async () => {} }
    ),
    (error) => error === failure
  );
  assert.equal(attempts, 3);
});

for (const status of [408, 429, 500, 502, 503, 504]) {
  test(`retries HTTP ${status}`, async () => {
    let attempts = 0;

    await retry(
      async () => {
        attempts += 1;
        if (attempts === 1) throw httpError(status);
      },
      { sleep: async () => {} }
    );

    assert.equal(attempts, 2);
  });
}

test("does not retry permanent HTTP 404 failures", async () => {
  let attempts = 0;
  const failure = httpError(404);

  await assert.rejects(
    retry(
      async () => {
        attempts += 1;
        throw failure;
      },
      { sleep: async () => {} }
    ),
    (error) => error === failure
  );
  assert.equal(attempts, 1);
});

for (const kind of ["timeout", "network"]) {
  test(`retries caller-classified ${kind} errors`, async () => {
    let attempts = 0;

    await retry(
      async () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error(kind), { kind });
      },
      {
        isRetryableError: (error) => error.kind === kind,
        sleep: async () => {},
      }
    );

    assert.equal(attempts, 2);
  });
}
