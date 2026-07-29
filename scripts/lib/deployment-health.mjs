import { lookup as dnsLookup } from "node:dns";
import https from "node:https";
import tls from "node:tls";
import { promisify } from "node:util";

const DEFAULT_TARGET = "https://docs.linkout.space";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const ENDPOINTS = ["/", "/robots.txt", "/sitemap.xml"];
const REQUIRED_CANONICAL = "https://docs.linkout.space/";
const lookupAll = promisify(dnsLookup);
const MONTHS = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    .map((month, index) => [month, index])
);

function errorDetail(error) {
  return [error?.code, error?.message].filter(Boolean).join(": ") || String(error);
}

function parseCertificateDate(value, label) {
  const match =
    /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s+GMT$/.exec(
      value || ""
    );
  const month = MONTHS.get(match?.[1]);
  const parts = match?.slice(2).map(Number);
  if (!match || month === undefined) {
    throw new Error(`TLS certificate has an invalid ${label} date`);
  }

  const [day, hour, minute, second, year] = parts;
  const timestamp = Date.UTC(year, month, day, hour, minute, second);
  const parsed = new Date(timestamp);
  if (
    year < 1000 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
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
  const nowTimestamp = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowTimestamp)) {
    throw new Error("TLS certificate validation current time is invalid");
  }

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

export function createHttpsRequester({
  requestImpl = https.request,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  return (url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) =>
    new Promise((resolve, reject) => {
      let request;
      let response;
      let responseCompleted = false;
      let settled = false;
      let deadline;

      const finish = (callback, value, { destroy = false } = {}) => {
        if (settled) return;
        settled = true;
        clearTimer(deadline);
        if (destroy) {
          response?.destroy();
          request?.destroy();
        }
        callback(value);
      };
      const fail = (message, cause) => {
        const error = new Error(message, cause ? { cause } : undefined);
        finish(reject, error, { destroy: true });
      };

      request = requestImpl(
        url,
        {
          rejectUnauthorized: true,
          servername: url.hostname,
        },
        (incomingResponse) => {
          response = incomingResponse;
          const chunks = [];
          let bodyBytes = 0;
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            if (settled) return;
            bodyBytes += Buffer.byteLength(chunk);
            if (bodyBytes > maxBodyBytes) {
              fail(`response exceeded ${maxBodyBytes} bytes`);
              return;
            }
            chunks.push(chunk);
          });
          response.once("error", (error) =>
            fail(`response failed (${error?.message || error})`, error)
          );
          response.once("aborted", () => fail("response aborted"));
          response.once("close", () => {
            if (!responseCompleted) {
              fail("response closed before completion");
            }
          });
          response.once("end", () => {
            responseCompleted = true;
            finish(resolve, {
              body: chunks.join(""),
              statusCode: response.statusCode,
            });
          });
        }
      );

      deadline = setTimer(() => {
        fail(`request deadline exceeded after ${timeoutMs}ms`);
      }, timeoutMs);
      request.once("error", (error) =>
        fail(error?.message || String(error), error)
      );
      request.end();
    });
}

function parseAttributes(tag) {
  const attributes = new Map();
  const source = tag.replace(/^<link\b/i, "").replace(/\/?>$/, "");
  const attributePattern =
    /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attributePattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) {
      attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return attributes;
}

function containsRequiredCanonical(body) {
  const markup = body.replace(/<!--[\s\S]*?-->/g, "");
  const linkTags = markup.match(/<link(?=\s|\/?>)[^>]*>/gi) || [];
  return linkTags.some((tag) => {
    const attributes = parseAttributes(tag);
    const relTokens = (attributes.get("rel") || "").split(/\s+/);
    return (
      relTokens.some((token) => token.toLowerCase() === "canonical") &&
      attributes.get("href") === REQUIRED_CANONICAL
    );
  });
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
