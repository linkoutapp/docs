import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function mappingBlock(source, key, indentation = 0) {
  const prefix = ' '.repeat(indentation);
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${prefix}${key}:`);

  assert.notEqual(start, -1, `Expected ${key} mapping`);

  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith(`${prefix} `)) {
      break;
    }
    block.push(line);
  }
  return block.join('\n');
}

function mappingKeys(source, indentation) {
  const prefix = ' '.repeat(indentation);
  return source
    .split(/\r?\n/)
    .map((line) =>
      line.match(new RegExp(`^${prefix}([^\\s:#][^:]*):(?:\\s.*)?$`)),
    )
    .filter(Boolean)
    .map((match) => match[1]);
}

function workflow(relativePath) {
  const source = read(relativePath);
  const permissions = source.match(
    /^permissions:\s*\n((?:^[ \t]+.*\n?)*)/m,
  )?.[1];

  assert.equal(permissions?.trim(), 'contents: read');
  assert.doesNotMatch(source, /\b(?:write-all|[a-z-]+:\s*write)\b/);
  assert.doesNotMatch(source, /\bsecrets\b/i);
  assert.match(source, /uses:\s*actions\/checkout@v6\b/);
  assert.match(source, /uses:\s*actions\/setup-node@v6\b/);
  assert.match(source, /node-version:\s*['"]?22['"]?\s*$/m);
  assert.match(source, /cache:\s*npm\s*$/m);
  assert.match(source, /cache-dependency-path:\s*package-lock\.json\s*$/m);
  assert.match(source, /run:\s*npm ci --ignore-scripts\s*$/m);
  assert.match(source, /^\s+timeout-minutes:\s*(?:[1-9]|[1-5]\d|60)\s*$/m);

  return source;
}

test('CI is a read-only main and pull-request repository gate', () => {
  const source = workflow('.github/workflows/ci.yml');
  const trigger = mappingBlock(source, 'on');
  const push = mappingBlock(trigger, 'push', 2);
  const branches = mappingBlock(push, 'branches', 4);

  assert.deepEqual(mappingKeys(trigger, 2), ['pull_request', 'push']);
  assert.equal(mappingBlock(trigger, 'pull_request', 2).trim(), '');
  assert.deepEqual(mappingKeys(push, 4), ['branches']);
  assert.deepEqual(
    branches
      .split(/\r?\n/)
      .map((line) => line.match(/^\s{6}-\s+(.+?)\s*$/)?.[1])
      .filter(Boolean),
    ['main'],
  );
  assert.match(
    source,
    /^concurrency:\s*\n\s{2}group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\s*\n\s{2}cancel-in-progress:\s*true\s*$/m,
  );
  assert.match(source, /^\s+runs-on:\s*ubuntu-latest\s*$/m);
  assert.match(source, /run:\s*npm run check\s*$/m);
  assert.doesNotMatch(source, /run:\s*npm run check:deploy\s*$/m);
});

test('deployment health is manual-only and runs the deploy check', () => {
  const source = workflow('.github/workflows/deployment-health.yml');
  const trigger = mappingBlock(source, 'on');

  assert.deepEqual(mappingKeys(trigger, 2), ['workflow_dispatch']);
  assert.equal(mappingBlock(trigger, 'workflow_dispatch', 2).trim(), '');
  assert.match(source, /^\s+runs-on:\s*ubuntu-latest\s*$/m);
  assert.match(source, /run:\s*npm run check:deploy\s*$/m);
  assert.doesNotMatch(source, /run:\s*npm run check\s*$/m);
});

test('repository checks compose each expensive local gate once', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(
    packageJson.scripts?.['check:local'],
    'git diff --check && npm run typecheck && npm test && npm run build',
  );
  assert.equal(
    packageJson.scripts?.['check:source'],
    'node scripts/check-source-contracts.mjs',
  );
  assert.equal(
    packageJson.scripts?.['check:deps'],
    'node scripts/check-dependencies.mjs',
  );
  assert.equal(
    packageJson.scripts?.['check:deploy'],
    'node scripts/check-deployment.mjs',
  );
  assert.equal(
    packageJson.scripts?.check,
    'npm run check:local && npm run check:deps && npm run check:source',
  );
});

test('Vercel applies the exact security headers to every route', () => {
  const config = JSON.parse(read('vercel.json'));

  assert.deepEqual(config, {
    headers: [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000',
          },
          {key: 'X-Content-Type-Options', value: 'nosniff'},
          {key: 'X-Frame-Options', value: 'DENY'},
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
        ],
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(config), /content-security-policy/i);
});

test('package metadata and the standard MIT license agree', () => {
  const packageJson = JSON.parse(read('package.json'));
  const license = read('LICENSE');

  assert.equal(packageJson.license, 'MIT');
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Linkout\n\n/);
  assert.match(
    license,
    /Permission is hereby granted, free of charge, to any person obtaining a copy/,
  );
  assert.match(
    license,
    /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR/,
  );
  assert.match(
    license,
    /IN NO EVENT SHALL THE\s+AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,/,
  );
});

test('Docusaurus keeps the dynamic Linkout MIT footer copyright', () => {
  const config = read('docusaurus.config.ts');

  assert.ok(
    config.includes(
      'copyright: `Copyright © ${new Date().getFullYear()} Linkout. MIT License.`,',
    ),
  );
});

test('README documents public operation and ownership', () => {
  const readme = read('README.md');

  for (const required of [
    'Node.js 22',
    'npm ci',
    'npm start',
    'npm run build',
    'npm run serve',
    'npm run check:local',
    'npm run check:source',
    'npm run check:deps',
    'npm run check:deploy',
    'npm run check',
    'docs.linkout.space',
    'Vercel',
  ]) {
    assert.ok(readme.includes(required), `README must include ${required}`);
  }
  assert.match(readme, /live source contracts?/i);
  assert.match(readme, /retr(?:y|ies)/i);
  assert.match(readme, /drift[\s\S]*fail/i);
  assert.match(readme, /accepted only through pull requests/i);
  assert.match(readme, /manual[\s\S]*deployment health/i);
  assert.match(readme, /TLS/i);
  assert.match(
    readme,
    /public\s+`linkoutapp\/linkout-scraper` repository's `main` branch/i,
  );
  assert.match(
    readme,
    /Linkout owns and operates the Vercel deployment for `docs\.linkout\.space`/,
  );
});

test('internal superpowers planning artifacts are not tracked', () => {
  const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);

  assert.deepEqual(
    trackedFiles.filter(
      (relativePath) =>
        relativePath === 'docs/superpowers' ||
        relativePath.startsWith('docs/superpowers/'),
    ),
    [],
  );
});
