import assert from "node:assert/strict";
import { fetchSourceText } from "./lib/source-fetch.mjs";

const RAW_BASE =
  "https://raw.githubusercontent.com/linkoutapp/linkout-scraper/main";
const FETCH_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 15_000;

const paths = [
  "package.json",
  "README.md",
  "lib/linkedin.service.js",
  "lib/browser/connect-local-chrome.js",
  "lib/policy/defaults.js",
  "lib/policy/action-policy.js",
  "lib/policy/ledger.js",
  "lib/mcp/tool-definitions.js",
  "lib/mcp/handlers.js",
  "lib/mcp/server.js",
  "bin/linkout-mcp.js",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "skills/linkedin-read/SKILL.md",
  "skills/linkedin-read/agents/openai.yaml",
];

function diagnostic(path, assertion) {
  return `${path}: ${assertion}`;
}

function equal(path, actual, expected, assertion) {
  assert.deepEqual(actual, expected, diagnostic(path, assertion));
}

function match(path, source, pattern, assertion) {
  assert.match(source, pattern, diagnostic(path, assertion));
}

function parseJson(path, source) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(diagnostic(path, `must contain valid JSON (${error.message})`), {
      cause: error,
    });
  }
}

async function read(path) {
  return fetchSourceText(path, {
    baseUrl: RAW_BASE,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
}

async function readAll(requestedPaths, concurrency = FETCH_CONCURRENCY) {
  const results = new Map();
  let next = 0;
  async function worker() {
    while (next < requestedPaths.length) {
      const index = next;
      next += 1;
      const path = requestedPaths[index];
      results.set(path, await read(path));
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, requestedPaths.length) },
      () => worker()
    )
  );
  return results;
}

function findBalanced(source, start, open = "{", close = "}") {
  assert.notEqual(start, -1, "internal source-contract parser start was not found");
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail("internal source-contract parser found an unbalanced block");
}

function objectPropertyBlock(path, source, property, from = 0) {
  const propertyPattern = new RegExp(`\\b${property}\\s*:\\s*\\{`, "g");
  propertyPattern.lastIndex = from;
  const found = propertyPattern.exec(source);
  assert.ok(found, diagnostic(path, `must define the ${property} object`));
  const open = source.indexOf("{", found.index);
  return findBalanced(source, open);
}

function shorthandKeys(block) {
  return block
    .slice(1, -1)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function callBlocks(path, source, functionName) {
  const blocks = [];
  const pattern = new RegExp(`\\b${functionName}\\s*\\(`, "g");
  let found;
  while ((found = pattern.exec(source))) {
    const open = source.indexOf("(", found.index);
    const block = findBalanced(source, open, "(", ")");
    blocks.push(block);
    pattern.lastIndex = open + block.length;
  }
  assert.ok(blocks.length > 0, diagnostic(path, `must call ${functionName}`));
  return blocks;
}

const source = await readAll(paths);
const text = (path) => {
  assert.ok(source.has(path), diagnostic(path, "was not fetched"));
  return source.get(path);
};

const packagePath = "package.json";
const packageJson = parseJson(packagePath, text(packagePath));
equal(packagePath, packageJson.name, "linkout-scraper", "package name changed");
equal(packagePath, packageJson.engines?.node, ">=22", "Node engine changed");
equal(
  packagePath,
  packageJson.bin?.["linkout-mcp"],
  "bin/linkout-mcp.js",
  "linkout-mcp binary path changed"
);
for (const packagedPath of [
  ".claude-plugin",
  ".codex-plugin",
  ".mcp.json",
  "bin",
  "lib",
  "skills",
  "README.md",
  "LICENSE",
]) {
  assert.ok(
    packageJson.files?.includes(packagedPath),
    diagnostic(packagePath, `publish allowlist must include ${packagedPath}`)
  );
}

const readmePath = "README.md";
match(
  readmePath,
  text(readmePath),
  /```sh\r?\nnpm install linkout-scraper --save\r?\n```/,
  "exact npm install command changed"
);

const entryPath = "lib/linkedin.service.js";
const entry = text(entryPath);
const exportsStart = entry.indexOf("module.exports");
assert.notEqual(
  exportsStart,
  -1,
  diagnostic(entryPath, "must define module.exports")
);
equal(
  entryPath,
  shorthandKeys(objectPropertyBlock(entryPath, entry, "services", exportsStart)),
  [
    "connect",
    "message",
    "messagesFromChat",
    "postsWithComments",
    "posts",
    "reactions",
    "comments",
    "connectionStatus",
    "visit",
    "acceptedConnections",
    "like",
    "endorse",
  ],
  "exported service namespace must contain exactly the 12 documented services"
);
equal(
  entryPath,
  shorthandKeys(objectPropertyBlock(entryPath, entry, "tools", exportsStart)),
  [
    "loadCursor",
    "connectLocalChrome",
    "validateDevtoolsEndpoint",
    "createActionPolicy",
    "detectPageState",
    "resolveSelector",
  ],
  "exported tools namespace must contain exactly the six documented tools"
);

const chromePath = "lib/browser/connect-local-chrome.js";
const chrome = text(chromePath);
match(
  chromePath,
  chrome,
  /browserURL\s*=\s*"http:\/\/127\.0\.0\.1:9222"/,
  "default DevTools endpoint must remain 127.0.0.1:9222"
);
match(
  chromePath,
  chrome,
  /if\s*\(\s*platform\s*!==\s*"darwin"\s*\)/,
  "macOS device gate changed"
);
match(
  chromePath,
  chrome,
  /endpoint\.protocol\s*!==\s*"http:"/,
  "DevTools endpoint must require HTTP"
);
match(
  chromePath,
  chrome,
  /!allowRemote\s*&&\s*!LOOPBACK_HOSTS\.has\(endpoint\.hostname\)/,
  "loopback-only validator or allowRemote escape hatch changed"
);
match(
  chromePath,
  chrome,
  /validateDevtoolsEndpoint\(browserURL,\s*\{\s*allowRemote\s*\}\)/,
  "allowRemote must be passed to endpoint validation"
);
const forbiddenMatch = chrome.match(
  /const FORBIDDEN_OVERRIDE_KEYS\s*=\s*\[([\s\S]*?)\];/
);
assert.ok(
  forbiddenMatch,
  diagnostic(chromePath, "must define forbidden fingerprint override keys")
);
equal(
  chromePath,
  [...forbiddenMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]),
  ["fingerprint", "userAgent", "locale", "timezone", "viewport"],
  "forbidden fingerprint override keys changed"
);
equal(
  chromePath,
  [...chrome.matchAll(/const LOOPBACK_HOSTS\s*=\s*new Set\(\[([\s\S]*?)\]\)/g)]
    .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)])
    .map((match) => match[1]),
  ["127.0.0.1", "localhost", "[::1]", "::1"],
  "loopback host allowlist changed"
);

const defaultsPath = "lib/policy/defaults.js";
const defaults = text(defaultsPath);
match(
  defaultsPath,
  defaults,
  /operatingHours:\s*Object\.freeze\(\{\s*start:\s*9,\s*end:\s*18\s*\}\)/,
  "operating hours must remain 09:00 through 18:00"
);
const defaultOperations = [
  ["connect", 10],
  ["message", 20],
  ["like", 30],
  ["endorse", 10],
];
for (const [operation, dailyLimit] of defaultOperations) {
  match(
    defaultsPath,
    defaults,
    new RegExp(
      `${operation}:\\s*Object\\.freeze\\(\\{\\s*enabled:\\s*false,\\s*dailyLimit:\\s*${dailyLimit}\\s*\\}\\)`
    ),
    `${operation} must remain disabled with daily limit ${dailyLimit}`
  );
}
equal(
  defaultsPath,
  [...defaults.matchAll(/^\s{4}(\w+):\s*Object\.freeze/gm)].map(
    (match) => match[1]
  ),
  defaultOperations.map(([operation]) => operation),
  "default operation set changed"
);

const policyPath = "lib/policy/action-policy.js";
const policy = text(policyPath);
equal(
  policyPath,
  [...policy.matchAll(/\bfail\(\s*"([A-Z_]+)"/g)].map((match) => match[1]),
  [
    "CONFIRMATION_REQUIRED",
    "OPERATION_DISABLED",
    "OUTSIDE_OPERATING_HOURS",
    "DAILY_LIMIT_REACHED",
    "PAGE_STATE_STOP",
  ],
  "documented policy error-code set changed"
);
match(
  policyPath,
  policy,
  /if\s*\(\s*!confirm\s*\)/,
  "explicit confirmation must use a truthy gate"
);
match(
  policyPath,
  policy,
  /function createMemoryLedger\(initial\s*=\s*\[\]\)/,
  "in-memory ledger constructor changed"
);
const memoryLedger = policy.slice(
  policy.indexOf("function createMemoryLedger"),
  policy.indexOf("function createActionPolicy")
);
for (const contract of [
  /entries\.push\(sanitizeLedgerEntry\(entry\)\)/,
  /entry\.operation\s*===\s*operation/,
  /entry\.localDate\s*===\s*date/,
  /entry\.outcome\s*===\s*"success"/,
  /async read\(\)/,
]) {
  match(policyPath, memoryLedger, contract, "in-memory ledger behavior changed");
}

const ledgerPath = "lib/policy/ledger.js";
const ledger = text(ledgerPath);
const sanitizedStart = ledger.indexOf("const sanitized =");
assert.notEqual(
  sanitizedStart,
  -1,
  diagnostic(ledgerPath, "must define the sanitized ledger entry")
);
const sanitizedBlock = findBalanced(
  ledger,
  ledger.indexOf("{", sanitizedStart)
);
equal(
  ledgerPath,
  [
    ...sanitizedBlock.matchAll(/^\s{4}(\w+):/gm),
  ].map((match) => match[1]),
  ["timestamp", "operation", "target", "outcome", "errorCode"],
  "persisted ledger fields changed"
);
match(
  ledgerPath,
  ledger,
  /if\s*\(\s*entry\.localDate\s*\)\s*sanitized\.localDate\s*=/,
  "optional localDate ledger field changed"
);
for (const key of ["operation", "localDate", "outcome"]) {
  match(
    ledgerPath,
    ledger,
    new RegExp(`entry\\.${key}\\s*===`),
    `successful-count key ${key} changed`
  );
}
match(
  ledgerPath,
  ledger,
  /entry\.outcome\s*===\s*"success"/,
  "successful ledger counts must only include success outcomes"
);
match(
  ledgerPath,
  ledger,
  /return\s*\{\s*append,\s*countSuccessful,\s*file,\s*read\s*\}/,
  "persistent ledger public methods changed"
);

const definitionsPath = "lib/mcp/tool-definitions.js";
const definitions = text(definitionsPath);
match(
  definitionsPath,
  definitions,
  /const count\s*=\s*Object\.freeze\(\{\s*type:\s*"integer",\s*minimum:\s*0,\s*maximum:\s*100,\s*default:\s*20\s*\}\)/,
  "count schema must remain integer 0..100 with default 20"
);
match(
  definitionsPath,
  definitions,
  /name,\s*description,\s*readOnly:\s*true,/,
  "all generated MCP definitions must remain read-only"
);
const toolCalls = callBlocks(definitionsPath, definitions, "tool").filter((block) =>
  /^\(\s*"/.test(block)
);
const expectedToolNames = [
  "linkedin_get_profile",
  "linkedin_get_connection_status",
  "linkedin_list_connections",
  "linkedin_read_message_thread",
  "linkedin_list_posts",
  "linkedin_list_reactions",
  "linkedin_list_comments",
  "linkedin_list_posts_with_comments",
];
equal(
  definitionsPath,
  toolCalls.map((block) => block.match(/^\(\s*"([^"]+)"/)?.[1]),
  expectedToolNames,
  "MCP tool names or exact eight-tool set changed"
);
const countTools = toolCalls
  .filter((block) => /\bcount\b/.test(block))
  .map((block) => block.match(/^\(\s*"([^"]+)"/)?.[1]);
equal(
  definitionsPath,
  countTools,
  [
    "linkedin_list_connections",
    "linkedin_read_message_thread",
    "linkedin_list_posts",
    "linkedin_list_reactions",
    "linkedin_list_comments",
  ],
  "count must appear on exactly the five documented MCP tools"
);

const handlersPath = "lib/mcp/handlers.js";
const handlers = text(handlersPath);
for (const [pattern, assertion] of [
  [/url\.protocol\s*!==\s*"https:"/, "URL validator must require HTTPS"],
  [
    /url\.hostname\s*!==\s*"www\.linkedin\.com"/,
    "URL validator must require www.linkedin.com",
  ],
  [
    /allowedPrefixes\.some\(\(prefix\)\s*=>\s*url\.pathname\.startsWith\(prefix\)\)/,
    "URL validator must enforce allowed path prefixes",
  ],
  [
    /return `\$\{url\.origin\}\$\{url\.pathname\}`/,
    "validated URLs must discard query strings and fragments",
  ],
  [
    /"INVALID_LINKEDIN_URL"/,
    "invalid LinkedIn URLs must retain their public error code",
  ],
  [
    /const code\s*=\s*error\s*&&\s*error\.code\s*\?\s*error\.code\s*:\s*"READ_FAILED"/,
    "unknown read failures must use READ_FAILED",
  ],
  [
    /isError:\s*true/,
    "failure envelope must retain the MCP isError marker",
  ],
  [
    /structuredContent:\s*\{\s*error:\s*\{\s*code,\s*message\s*\}\s*\}/,
    "failure envelope changed",
  ],
  [
    /structuredContent:\s*\{\s*result\s*\}/,
    "success envelope changed",
  ],
  [
    /catch\s*\(error\)\s*\{\s*return failure\(error\);/,
    "main handler call must return the documented failure envelope",
  ],
]) {
  match(handlersPath, handlers, pattern, assertion);
}
const handlerRestrictions = [
  ["linkedin_get_profile", "url", '["/in/"]'],
  ["linkedin_get_connection_status", "url", '["/in/"]'],
  ["linkedin_read_message_thread", "threadUrl", '["/messaging/thread/"]'],
  ["linkedin_list_posts", "profileUrl", '["/in/"]'],
  ["linkedin_list_reactions", "profileUrl", '["/in/"]'],
  ["linkedin_list_comments", "profileUrl", '["/in/"]'],
  [
    "linkedin_list_posts_with_comments",
    "activityUrl",
    '["/feed/update/", "/posts/"]',
  ],
];
for (const [toolName, argument, prefixes] of handlerRestrictions) {
  const escapedPrefixes = prefixes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  match(
    handlersPath,
    handlers,
    new RegExp(
      `${toolName}:[\\s\\S]{0,300}?validateLinkedInUrl\\(${argument},\\s*${escapedPrefixes}\\)`
    ),
    `${toolName} URL restriction changed`
  );
}

const serverPath = "lib/mcp/server.js";
const server = text(serverPath);
match(
  serverPath,
  server,
  /startServer\(\{\s*browserURL\s*=\s*process\.env\.LINKOUT_CHROME_URL\s*\}\s*=\s*\{\}\)/,
  "LINKOUT_CHROME_URL server input changed"
);
match(
  serverPath,
  server,
  /browserURL:\s*browserURL\s*\|\|\s*"http:\/\/127\.0\.0\.1:9222"/,
  "server DevTools endpoint fallback changed"
);
match(
  serverPath,
  server,
  /annotations:\s*\{\s*readOnlyHint:\s*true,\s*destructiveHint:\s*false\s*\}/,
  "MCP registration read-only annotations changed"
);
match(
  serverPath,
  server,
  /process\.stderr\.write\(`Linkout MCP failed: \$\{error\.code \|\| "START_FAILED"\}\\n`\)/,
  "server startup error format changed"
);

const cliPath = "bin/linkout-mcp.js";
const cli = text(cliPath);
match(
  cliPath,
  cli,
  /^#!\/usr\/bin\/env node/,
  "CLI executable shebang changed"
);
match(
  cliPath,
  cli,
  /require\("\.\.\/lib\/mcp\/server"\)\.startServer\(\)/,
  "CLI server startup path changed"
);
match(
  cliPath,
  cli,
  /process\.stderr\.write\(`Linkout MCP failed: \$\{error\.code \|\| "START_FAILED"\}\\n`\)/,
  "CLI startup error format changed"
);
match(
  cliPath,
  cli,
  /process\.exitCode\s*=\s*1/,
  "CLI startup failure must remain nonzero"
);

const pluginExpectations = [
  [".claude-plugin/plugin.json", true],
  [".codex-plugin/plugin.json", false],
];
for (const [pluginPath, claudeManifest] of pluginExpectations) {
  const plugin = parseJson(pluginPath, text(pluginPath));
  equal(
    pluginPath,
    plugin.name,
    "linkout-linkedin-read",
    "plugin name changed"
  );
  equal(
    pluginPath,
    plugin.skills,
    "./skills/",
    "packaged skills path changed"
  );
  assert.match(
    plugin.description,
    /\bRead\b/,
    diagnostic(pluginPath, "plugin description must retain its read-only claim")
  );
  if (claudeManifest) {
    equal(
      pluginPath,
      plugin.mcpServers,
      "./.mcp.json",
      "Claude MCP manifest path changed"
    );
  } else {
    equal(
      pluginPath,
      plugin.mcpServers?.["linkout-linkedin-read"]?.args,
      ["./bin/linkout-mcp.js"],
      "Codex MCP CLI path changed"
    );
    equal(
      pluginPath,
      plugin.mcpServers?.["linkout-linkedin-read"]?.env?.LINKOUT_CHROME_URL,
      "http://127.0.0.1:9222",
      "Codex plugin DevTools endpoint changed"
    );
    equal(
      pluginPath,
      plugin.interface?.capabilities,
      ["Read-only", "Local"],
      "Codex plugin bounded capabilities changed"
    );
  }
}

const mcpPath = ".mcp.json";
const mcp = parseJson(mcpPath, text(mcpPath));
equal(
  mcpPath,
  mcp.mcpServers?.["linkout-linkedin-read"]?.args,
  ["${CLAUDE_PLUGIN_ROOT}/bin/linkout-mcp.js"],
  "Claude MCP packaged CLI path changed"
);
equal(
  mcpPath,
  mcp.mcpServers?.["linkout-linkedin-read"]?.env?.LINKOUT_CHROME_URL,
  "http://127.0.0.1:9222",
  "Claude MCP DevTools endpoint changed"
);

const skillPath = "skills/linkedin-read/SKILL.md";
const skill = text(skillPath);
for (const [pattern, assertion] of [
  [
    /bounded, read-only inspection/,
    "skill must retain its bounded read-only scope",
  ],
  [
    /Use the smallest practical `count`/,
    "skill must retain bounded count guidance",
  ],
  [
    /This skill is read-only\./,
    "skill must retain the explicit read-only boundary",
  ],
  [
    /Never type, send a message, connect, invite, like, endorse/,
    "skill must retain mutation prohibitions",
  ],
  [
    /Do not broaden a request into bulk collection\./,
    "skill must retain bulk-collection prohibition",
  ],
]) {
  match(skillPath, skill, pattern, assertion);
}
for (const toolName of expectedToolNames) {
  match(
    skillPath,
    skill,
    new RegExp(`\\b${toolName}\\b`),
    `skill must document ${toolName}`
  );
}

const openAiSkillPath = "skills/linkedin-read/agents/openai.yaml";
match(
  openAiSkillPath,
  text(openAiSkillPath),
  /default_prompt:\s*"Read the requested LinkedIn information without changing the account\."/,
  "OpenAI skill prompt must remain bounded and read-only"
);

console.log(
  `Verified ${paths.length} public linkout-scraper source files and high-risk contracts.`
);
