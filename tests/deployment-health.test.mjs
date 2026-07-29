import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  checkDeployment,
  createHttpsRequester,
  validateCertificate,
} from "../scripts/lib/deployment-health.mjs";

const TARGET = "https://docs.linkout.space";
const VALID_CERTIFICATE = {
  valid_from: "Jan 01 00:00:00 2026 GMT",
  valid_to: "Jan 01 00:00:00 2027 GMT",
  subjectaltname: "DNS:docs.linkout.space",
};
const CANONICAL_LINK =
  '<link rel="canonical" href="https://docs.linkout.space/">';
const CANONICAL_HEAD = `<html><head>${CANONICAL_LINK}</head><body></body></html>`;

function healthyDependencies(overrides = {}) {
  return {
    lookup: async () => [{ address: "192.0.2.1", family: 4 }],
    inspectTls: async () => VALID_CERTIFICATE,
    request: async (url) => ({
      body:
        url.pathname === "/"
          ? CANONICAL_HEAD
          : "ok",
      statusCode: 200,
    }),
    now: new Date("2026-07-29T00:00:00Z"),
    ...overrides,
  };
}

function fakeHttpsExchange({ statusCode = 200 } = {}) {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  response.destroyed = false;
  response.setEncoding = () => {};
  response.destroy = () => {
    response.destroyed = true;
  };

  const request = new EventEmitter();
  request.destroyed = false;
  request.setTimeout = () => {};
  request.destroy = () => {
    request.destroyed = true;
  };
  request.end = () => {};

  return { request, response };
}

test("reports a DNS lookup failure with the hostname", async () => {
  await assert.rejects(
    checkDeployment({
      ...healthyDependencies({
        lookup: async () => {
          throw Object.assign(new Error("query failed"), { code: "ENOTFOUND" });
        },
      }),
    }),
    /docs\.linkout\.space: DNS lookup failed \(ENOTFOUND: query failed\)/
  );
});

test("rejects an empty DNS result", async () => {
  await assert.rejects(
    checkDeployment({ ...healthyDependencies({ lookup: async () => [] }) }),
    /docs\.linkout\.space: DNS lookup returned no addresses/
  );
});

test("rejects an expired certificate", () => {
  assert.throws(
    () =>
      validateCertificate(VALID_CERTIFICATE, "docs.linkout.space", {
        now: new Date("2027-01-01T00:00:01Z"),
      }),
    /TLS certificate expired/
  );
});

test("rejects a certificate that is not yet valid", () => {
  assert.throws(
    () =>
      validateCertificate(VALID_CERTIFICATE, "docs.linkout.space", {
        now: new Date("2025-12-31T23:59:59Z"),
      }),
    /TLS certificate is not valid until/
  );
});

test("rejects a certificate hostname mismatch", () => {
  assert.throws(
    () =>
      validateCertificate(
        { ...VALID_CERTIFICATE, subjectaltname: "DNS:other.example" },
        "docs.linkout.space",
        { now: new Date("2026-07-29T00:00:00Z") }
      ),
    /TLS certificate hostname mismatch/
  );
});

test("rejects impossible certificate dates instead of normalizing them", () => {
  assert.throws(
    () =>
      validateCertificate(
        { ...VALID_CERTIFICATE, valid_from: "Feb 30 00:00:00 2026 GMT" },
        "docs.linkout.space",
        { now: new Date("2026-07-29T00:00:00Z") }
      ),
    /TLS certificate has an invalid valid-from date/
  );
});

test("rejects an invalid current time", () => {
  assert.throws(
    () =>
      validateCertificate(VALID_CERTIFICATE, "docs.linkout.space", {
        now: new Date("invalid"),
      }),
    /current time is invalid/
  );
});

test("reports TLS and CA verification failures", async () => {
  await assert.rejects(
    checkDeployment({
      ...healthyDependencies({
        inspectTls: async () => {
          throw Object.assign(new Error("unable to verify the first certificate"), {
            code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          });
        },
      }),
    }),
    /docs\.linkout\.space: TLS validation failed \(UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate\)/
  );
});

test("reports an endpoint timeout with its path", async () => {
  await assert.rejects(
    checkDeployment({
      ...healthyDependencies({
        request: async (url) => {
          if (url.pathname === "/robots.txt") {
            throw Object.assign(new Error("timed out after 5000ms"), {
              code: "ETIMEDOUT",
            });
          }
          return { body: CANONICAL_HEAD, statusCode: 200 };
        },
      }),
    }),
    /\/robots\.txt: request failed \(ETIMEDOUT: timed out after 5000ms\)/
  );
});

for (const endpoint of ["/", "/robots.txt", "/sitemap.xml"]) {
  test(`rejects a non-2xx response from ${endpoint}`, async () => {
    await assert.rejects(
      checkDeployment({
        ...healthyDependencies({
          request: async (url) => ({
            body:
              url.pathname === "/"
                ? CANONICAL_HEAD
                : "",
            statusCode: url.pathname === endpoint ? 503 : 200,
          }),
        }),
      }),
      new RegExp(`${endpoint.replace(/[/.]/g, "\\$&")}: returned HTTP 503`)
    );
  });
}

test("rejects a homepage without the required canonical URL", async () => {
  await assert.rejects(
    checkDeployment({
      ...healthyDependencies({
        request: async () => ({ body: "<html></html>", statusCode: 200 }),
      }),
    }),
    /\/: missing canonical https:\/\/docs\.linkout\.space\//
  );
});

for (const fakeCanonical of [
  `<html><head><!-- ${CANONICAL_LINK} --></head></html>`,
  `<html><head><!-- ${CANONICAL_LINK}</head></html>`,
  '<html><head><link data-rel="canonical" data-href="https://docs.linkout.space/"></head></html>',
]) {
  test(`rejects canonical lookalike: ${fakeCanonical.slice(0, 24)}`, async () => {
    await assert.rejects(
      checkDeployment({
        ...healthyDependencies({
          request: async () => ({ body: fakeCanonical, statusCode: 200 }),
        }),
      }),
      /\/: missing canonical https:\/\/docs\.linkout\.space\//
    );
  });
}

for (const [container, markup] of [
  ["script", `<script>const example = '${CANONICAL_LINK}'</script>`],
  ["style", `<style>/* ${CANONICAL_LINK} */</style>`],
  ["textarea", `<textarea>${CANONICAL_LINK}</textarea>`],
  ["template", `<template>${CANONICAL_LINK}</template>`],
  ["noscript", `<noscript>${CANONICAL_LINK}</noscript>`],
  ["xmp", `<xmp>${CANONICAL_LINK}</xmp>`],
]) {
  test(`rejects a canonical string inside ${container}`, async () => {
    await assert.rejects(
      checkDeployment({
        ...healthyDependencies({
          request: async () => ({
            body: `<html><head>${markup}</head><body></body></html>`,
            statusCode: 200,
          }),
        }),
      }),
      /\/: missing canonical https:\/\/docs\.linkout\.space\//
    );
  });
}

test("rejects a real canonical link outside the document head", async () => {
  await assert.rejects(
    checkDeployment({
      ...healthyDependencies({
        request: async () => ({
          body: `<html><head></head><body>${CANONICAL_LINK}</body></html>`,
          statusCode: 200,
        }),
      }),
    }),
    /\/: missing canonical https:\/\/docs\.linkout\.space\//
  );
});

for (const validCanonical of [
  '<link rel="canonical" href="https://docs.linkout.space/">',
  "<LINK HREF='https://docs.linkout.space/' REL='stylesheet CANONICAL'>",
  "<link href=https://docs.linkout.space/ rel=canonical>",
]) {
  test(`accepts a real head canonical with variant attributes: ${validCanonical.slice(0, 28)}`, async () => {
    await checkDeployment({
      ...healthyDependencies({
        request: async (url) => ({
          body:
            url.pathname === "/"
              ? `<HTML><HEAD>${validCanonical}</HEAD><BODY></BODY></HTML>`
              : "ok",
          statusCode: 200,
        }),
      }),
    });
  });
}

test("enforces an absolute HTTPS response deadline during slow-drip data", async () => {
  const { request, response } = fakeHttpsExchange();
  let deadline;
  const requester = createHttpsRequester({
    requestImpl: (_url, _options, onResponse) => {
      request.end = () => onResponse(response);
      return request;
    },
    setTimer: (callback) => {
      deadline = callback;
      return {};
    },
    clearTimer: () => {},
  });

  const pending = requester(new URL(`${TARGET}/robots.txt`), { timeoutMs: 25 });
  response.emit("data", "still arriving");
  assert.equal(typeof deadline, "function");
  deadline();

  await assert.rejects(
    pending,
    /request deadline exceeded after 25ms/
  );
  assert.equal(request.destroyed, true);
  assert.equal(response.destroyed, true);
});

test("rejects and destroys an oversized HTTPS response", async () => {
  const { request, response } = fakeHttpsExchange();
  const requester = createHttpsRequester({
    maxBodyBytes: 4,
    requestImpl: (_url, _options, onResponse) => {
      request.end = () => {
        onResponse(response);
        response.emit("data", "12345");
        response.emit("end");
      };
      return request;
    },
  });

  await assert.rejects(
    requester(new URL(`${TARGET}/sitemap.xml`)),
    /response exceeded 4 bytes/
  );
  assert.equal(request.destroyed, true);
  assert.equal(response.destroyed, true);
});

for (const [event, expected] of [
  ["error", /response failed \(stream failed\)/],
  ["aborted", /response aborted/],
  ["close", /response closed before completion/],
]) {
  test(`rejects cleanly when the HTTPS response emits ${event}`, async () => {
    const { request, response } = fakeHttpsExchange();
    const requester = createHttpsRequester({
      requestImpl: (_url, _options, onResponse) => {
        request.end = () => {
          onResponse(response);
          if (event === "error") {
            response.emit(event, new Error("stream failed"));
          } else {
            response.emit(event);
          }
          response.emit("end");
        };
        return request;
      },
    });

    await assert.rejects(requester(new URL(`${TARGET}/`)), expected);
    assert.equal(request.destroyed, true);
    assert.equal(response.destroyed, true);
  });
}

test("checks the default hostname and all required endpoints successfully", async () => {
  const lookedUp = [];
  const tlsHosts = [];
  const requested = [];

  const result = await checkDeployment({
    ...healthyDependencies({
      lookup: async (hostname) => {
        lookedUp.push(hostname);
        return [{ address: "2001:db8::1", family: 6 }];
      },
      inspectTls: async (hostname) => {
        tlsHosts.push(hostname);
        return VALID_CERTIFICATE;
      },
      request: async (url, options) => {
        requested.push({ url: url.href, timeoutMs: options.timeoutMs });
        return {
          body:
            url.pathname === "/"
              ? '<html><head><link href="https://docs.linkout.space/" rel="canonical"></head></html>'
              : "ok",
          statusCode: 204,
        };
      },
    }),
  });

  assert.deepEqual(lookedUp, ["docs.linkout.space"]);
  assert.deepEqual(tlsHosts, ["docs.linkout.space"]);
  assert.deepEqual(requested, [
    { url: `${TARGET}/`, timeoutMs: 5_000 },
    { url: `${TARGET}/robots.txt`, timeoutMs: 5_000 },
    { url: `${TARGET}/sitemap.xml`, timeoutMs: 5_000 },
  ]);
  assert.deepEqual(result, {
    addresses: ["2001:db8::1"],
    endpoints: ["/", "/robots.txt", "/sitemap.xml"],
    hostname: "docs.linkout.space",
  });
});
