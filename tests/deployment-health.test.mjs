import assert from "node:assert/strict";
import test from "node:test";

import {
  checkDeployment,
  validateCertificate,
} from "../scripts/lib/deployment-health.mjs";

const TARGET = "https://docs.linkout.space";
const VALID_CERTIFICATE = {
  valid_from: "Jan 01 00:00:00 2026 GMT",
  valid_to: "Jan 01 00:00:00 2027 GMT",
  subjectaltname: "DNS:docs.linkout.space",
};

function healthyDependencies(overrides = {}) {
  return {
    lookup: async () => [{ address: "192.0.2.1", family: 4 }],
    inspectTls: async () => VALID_CERTIFICATE,
    request: async (url) => ({
      body:
        url.pathname === "/"
          ? '<link rel="canonical" href="https://docs.linkout.space/">'
          : "ok",
      statusCode: 200,
    }),
    now: new Date("2026-07-29T00:00:00Z"),
    ...overrides,
  };
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
          return { body: '<link rel="canonical" href="https://docs.linkout.space/">', statusCode: 200 };
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
                ? '<link rel="canonical" href="https://docs.linkout.space/">'
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
              ? '<link href="https://docs.linkout.space/" rel="canonical">'
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
