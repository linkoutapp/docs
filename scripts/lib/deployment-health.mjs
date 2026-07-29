import { lookup as dnsLookup } from "node:dns";
import https from "node:https";
import tls from "node:tls";
import { promisify } from "node:util";

const DEFAULT_TARGET = "https://docs.linkout.space";
const DEFAULT_TIMEOUT_MS = 5_000;
const ENDPOINTS = ["/", "/robots.txt", "/sitemap.xml"];
const REQUIRED_CANONICAL = "https://docs.linkout.space/";
const lookupAll = promisify(dnsLookup);

function errorDetail(error) {
  return [error?.code, error?.message].filter(Boolean).join(": ") || String(error);
}

function parseCertificateDate(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`TLS certificate has an invalid ${label} date`);
  }
  return timestamp;
}

export function validateCertificate(
  certificate,
  hostname,
  { now = new Date(), checkServerIdentity = tls.checkServerIdentity } = {}
) {
  const validFrom = parseCertificateDate(certificate?.valid_from, "valid-from");
  const validTo = parseCertificateDate(certificate?.valid_to, "valid-to");
  const nowTimestamp = now.getTime();

  if (nowTimestamp < validFrom) {
    throw new Error(
      `TLS certificate is not valid until ${certificate.valid_from}`
    );
  }
  if (nowTimestamp > validTo) {
    throw new Error(`TLS certificate expired at ${certificate.valid_to}`);
  }

  const hostnameError = checkServerIdentity(hostname, certificate);
  if (hostnameError) {
    throw new Error(
      `TLS certificate hostname mismatch: ${hostnameError.message}`,
      { cause: hostnameError }
    );
  }
}

export function createTlsInspector({
  connect = tls.connect,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return (hostname, { port = 443 } = {}) =>
    new Promise((resolve, reject) => {
      const socket = connect({
        host: hostname,
        port,
        rejectUnauthorized: true,
        servername: hostname,
      });
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        callback(value);
      };
      const timer = setTimeout(() => {
        const error = Object.assign(
          new Error(`TLS handshake timed out after ${timeoutMs}ms`),
          { code: "ETIMEDOUT" }
        );
        finish(reject, error);
      }, timeoutMs);

      socket.once("secureConnect", () => finish(resolve, socket.getPeerCertificate()));
      socket.once("error", (error) => finish(reject, error));
    });
}

export function createHttpsRequester({ requestImpl = https.request } = {}) {
  return (url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) =>
    new Promise((resolve, reject) => {
      const request = requestImpl(
        url,
        {
          rejectUnauthorized: true,
          servername: url.hostname,
        },
        (response) => {
          const chunks = [];
          response.setEncoding("utf8");
          response.on("data", (chunk) => chunks.push(chunk));
          response.once("end", () =>
            resolve({
              body: chunks.join(""),
              statusCode: response.statusCode,
            })
          );
        }
      );

      request.setTimeout(timeoutMs, () => {
        request.destroy(
          Object.assign(new Error(`timed out after ${timeoutMs}ms`), {
            code: "ETIMEDOUT",
          })
        );
      });
      request.once("error", reject);
      request.end();
    });
}

function containsRequiredCanonical(body) {
  const linkTags = body.match(/<link\b[^>]*>/gi) || [];
  return linkTags.some(
    (tag) =>
      /\brel\s*=\s*["'][^"']*\bcanonical\b[^"']*["']/i.test(tag) &&
      new RegExp(
        `\\bhref\\s*=\\s*["']${REQUIRED_CANONICAL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
        "i"
      ).test(tag)
  );
}

export async function checkDeployment({
  target = DEFAULT_TARGET,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  lookup = (hostname) => lookupAll(hostname, { all: true }),
  inspectTls = createTlsInspector({ timeoutMs }),
  request = createHttpsRequester(),
  now = new Date(),
} = {}) {
  const baseUrl = new URL(target);
  const hostname = baseUrl.hostname;
  let addresses;

  try {
    addresses = await lookup(hostname);
  } catch (error) {
    throw new Error(`${hostname}: DNS lookup failed (${errorDetail(error)})`, {
      cause: error,
    });
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error(`${hostname}: DNS lookup returned no addresses`);
  }

  let certificate;
  try {
    certificate = await inspectTls(hostname, {
      port: baseUrl.port ? Number(baseUrl.port) : 443,
      timeoutMs,
    });
    validateCertificate(certificate, hostname, { now });
  } catch (error) {
    throw new Error(
      `${hostname}: TLS validation failed (${errorDetail(error)})`,
      { cause: error }
    );
  }

  for (const endpoint of ENDPOINTS) {
    const url = new URL(endpoint, baseUrl);
    let response;
    try {
      response = await request(url, { timeoutMs });
    } catch (error) {
      throw new Error(
        `${endpoint}: request failed (${errorDetail(error)})`,
        { cause: error }
      );
    }
    if (
      !Number.isInteger(response?.statusCode) ||
      response.statusCode < 200 ||
      response.statusCode >= 300
    ) {
      throw new Error(`${endpoint}: returned HTTP ${response?.statusCode ?? "unknown"}`);
    }
    if (endpoint === "/" && !containsRequiredCanonical(response.body || "")) {
      throw new Error(`/: missing canonical ${REQUIRED_CANONICAL}`);
    }
  }

  return {
    addresses: addresses.map(({ address }) => address),
    endpoints: [...ENDPOINTS],
    hostname,
  };
}
