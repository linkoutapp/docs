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

test('GitHub Actions workflows are not tracked', () => {
  assert.deepEqual(
    [
      '.github/workflows/ci.yml',
      '.github/workflows/deployment-health.yml',
    ].filter((relativePath) =>
      fs.existsSync(path.join(repositoryRoot, relativePath)),
    ),
    [],
  );
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

test('README documents public operation and deployment target', () => {
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
  assert.match(readme, /working-tree diff/i);
  assert.match(readme, /retr(?:y|ies)/i);
  assert.match(readme, /drift[\s\S]*fail/i);
  assert.match(readme, /accepted only through pull requests/i);
  assert.match(readme, /run[\s\S]*deployment health[\s\S]*manually/i);
  assert.match(readme, /TLS/i);
  assert.match(
    readme,
    /public\s+`linkoutapp\/linkout-scraper` repository's `main` branch/i,
  );
  assert.match(
    readme,
    /dedicated Vercel project serving\s+`docs\.linkout\.space`/i,
  );
  assert.match(readme, /repository changes do not (?:change|mutate).*project.*DNS/i);
  assert.doesNotMatch(readme, /GitHub Actions|CI runs/i);
  assert.doesNotMatch(readme, /owns and operates/i);
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
