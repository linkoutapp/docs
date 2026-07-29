import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {load as loadYaml} from 'js-yaml';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

const checkoutAction =
  'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803';
const setupNodeAction =
  'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38';
const pushDiffScript = [
  'before="${{ github.event.before }}"',
  'after="${{ github.sha }}"',
  'empty_tree="$(git hash-object -t tree -w /dev/null)"',
  'if [ "$before" = "0000000000000000000000000000000000000000" ] ||',
  '  ! git cat-file -e "$before^{commit}" 2>/dev/null',
  'then',
  '  git diff --check "$empty_tree" "$after"',
  'else',
  '  git diff --check "$before..$after"',
  'fi',
  '',
].join('\n');

function parseWorkflow(source, label = 'workflow') {
  try {
    const parsed = loadYaml(source);
    assert.ok(
      parsed && typeof parsed === 'object' && !Array.isArray(parsed),
      `${label} must be a YAML mapping`,
    );
    return parsed;
  } catch (error) {
    throw new Error(`${label} must contain valid workflow YAML`, {cause: error});
  }
}

function assertWorkflow(source, expected, label) {
  const parsed = parseWorkflow(source, label);
  assert.deepEqual(parsed, expected);
  return parsed;
}

test('CI is a read-only main and pull-request repository gate', () => {
  const source = read('.github/workflows/ci.yml');

  const workflow = assertWorkflow(source, {
    name: 'CI',
    on: {
      pull_request: null,
      push: {branches: ['main']},
    },
    permissions: {contents: 'read'},
    concurrency: {
      group: '${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': true,
    },
    jobs: {
      check: {
        'runs-on': 'ubuntu-latest',
        'timeout-minutes': 20,
        steps: [
          {
            name: 'Check out repository',
            uses: checkoutAction,
            with: {'fetch-depth': 0, 'persist-credentials': false},
          },
          {
            name: 'Check pull request diff',
            if: "github.event_name == 'pull_request'",
            run: 'git diff --check "${{ github.event.pull_request.base.sha }}...${{ github.sha }}"',
          },
          {
            name: 'Check push diff',
            if: "github.event_name == 'push'",
            run: pushDiffScript,
          },
          {
            name: 'Set up Node.js',
            uses: setupNodeAction,
            with: {
              'node-version': 22,
              cache: 'npm',
              'cache-dependency-path': 'package-lock.json',
            },
          },
          {name: 'Install dependencies', run: 'npm ci --ignore-scripts'},
          {name: 'Check repository', run: 'npm run check'},
        ],
      },
    },
  }, 'CI workflow');
  assert.match(
    source,
    /uses:\s*actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803\s+# v6/,
  );
  assert.match(
    source,
    /uses:\s*actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38\s+# v6/,
  );
  const pushRun = workflow.jobs.check.steps[2].run;
  assert.match(
    pushRun,
    /\[ "\$before" = "0000000000000000000000000000000000000000" \]/,
  );
  assert.match(
    pushRun,
    /! git cat-file -e "\$before\^\{commit\}" 2>\/dev\/null/,
  );
  assert.match(pushRun, /git diff --check "\$empty_tree" "\$after"/);
  assert.match(pushRun, /git diff --check "\$before\.\.\$after"/);
});

test('deployment health is manual-only and runs the deploy check', () => {
  const source = read('.github/workflows/deployment-health.yml');

  assertWorkflow(source, {
    name: 'Deployment health',
    on: {workflow_dispatch: null},
    permissions: {contents: 'read'},
    jobs: {
      'deployment-health': {
        'runs-on': 'ubuntu-latest',
        'timeout-minutes': 10,
        steps: [
          {
            name: 'Check out repository',
            uses: checkoutAction,
            with: {'persist-credentials': false},
          },
          {
            name: 'Set up Node.js',
            uses: setupNodeAction,
            with: {
              'node-version': 22,
              cache: 'npm',
              'cache-dependency-path': 'package-lock.json',
            },
          },
          {name: 'Install dependencies', run: 'npm ci --ignore-scripts'},
          {name: 'Check deployment', run: 'npm run check:deploy'},
        ],
      },
    },
  }, 'deployment workflow');
  assert.match(
    source,
    /uses:\s*actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803\s+# v6/,
  );
  assert.match(
    source,
    /uses:\s*actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38\s+# v6/,
  );
});

test('workflow contracts reject malformed YAML and misplaced commands', () => {
  assert.throws(
    () => parseWorkflow('on:\n  push: [', 'broken workflow'),
    /broken workflow must contain valid workflow YAML/,
  );
  assert.throws(
    () =>
      assertWorkflow(
        'name: Example\non:\n  push:\njobs:\n  check:\n    run: npm test\n',
        {
          name: 'Example',
          on: {push: null},
          jobs: {check: {steps: [{run: 'npm test'}]}},
        },
        'misplaced command workflow',
      ),
    assert.AssertionError,
  );
});

test('push diff fallback checks the current commit from the empty tree', (t) => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), 'linkout-push-diff-'),
  );
  t.after(() => fs.rmSync(repository, {recursive: true, force: true}));

  const git = (...args) =>
    execFileSync('git', args, {cwd: repository, encoding: 'utf8'}).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Linkout CI');
  git('config', 'user.email', 'ci@linkout.space');
  fs.writeFileSync(path.join(repository, 'fixture.txt'), 'clean\n');
  git('add', 'fixture.txt');
  git('commit', '--quiet', '-m', 'Initial');
  fs.writeFileSync(path.join(repository, 'fixture.txt'), 'trailing whitespace \n');
  git('add', 'fixture.txt');
  git('commit', '--quiet', '-m', 'Introduce whitespace');
  const after = git('rev-parse', 'HEAD');
  const script = pushDiffScript
    .replace('${{ github.event.before }}', '${BEFORE}')
    .replace('${{ github.sha }}', '${AFTER}');

  for (const before of [
    '0000000000000000000000000000000000000000',
    '1111111111111111111111111111111111111111',
  ]) {
    assert.throws(
      () =>
        execFileSync('sh', ['-eu', '-c', script], {
          cwd: repository,
          env: {...process.env, AFTER: after, BEFORE: before},
          stdio: 'pipe',
        }),
      {status: 2},
    );
  }
});

test('repository checks compose each expensive local gate once', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(packageJson.devDependencies?.['js-yaml'], '4.3.0');
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
  assert.match(readme, /check:local` checks the working-tree diff/i);
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
