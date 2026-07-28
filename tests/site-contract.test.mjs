import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const requiredDocs = [
  'docs/introduction.mdx',
  'docs/getting-started/requirements.mdx',
  'docs/getting-started/installation.mdx',
  'docs/getting-started/authentication.mdx',
  'docs/getting-started/first-action.mdx',
  'docs/actions/services.mdx',
  'docs/workflows/action-policy.mdx',
  'docs/interfaces/cli.mdx',
  'docs/interfaces/node-api.mdx',
  'docs/interfaces/mcp.mdx',
  'docs/interfaces/agent-plugins.mdx',
  'docs/architecture/runtime.mdx',
  'docs/operations/troubleshooting.mdx',
  'docs/operations/safety.mdx',
  'docs/contributing.mdx',
];

const {loadSiteConfig} = await import(
  '@docusaurus/core/lib/server/config.js',
);
const {siteConfig} = await loadSiteConfig({siteDir: repositoryRoot});

function readDoc(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  return fs.existsSync(absolutePath)
    ? fs.readFileSync(absolutePath, 'utf8')
    : '';
}

function frontmatterValue(source, key) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) {
    return undefined;
  }

  const field = frontmatter[1]
    .split(/\r?\n/)
    .find((line) => line.match(new RegExp(`^${key}\\s*:`)));

  return field?.replace(new RegExp(`^${key}\\s*:\\s*`), '').trim();
}

const docsByPath = new Map(
  requiredDocs.map((relativePath) => [relativePath, readDoc(relativePath)]),
);
const corpus = [...docsByPath.values()].join('\n');
const themeCss = readDoc('src/css/custom.css');
const packageJson = JSON.parse(readDoc('package.json'));
const classicPreset = siteConfig.presets.find(
  ([presetName]) =>
    presetName === 'classic' || presetName === '@docusaurus/preset-classic',
);

test('every required documentation page exists', () => {
  const missingDocs = requiredDocs.filter(
    (relativePath) => !fs.existsSync(path.join(repositoryRoot, relativePath)),
  );

  assert.deepEqual(missingDocs, []);
});

test('Docusaurus uses the production URL', () => {
  assert.equal(siteConfig.url, 'https://docs.linkout.space');
});

test('Docusaurus has an active classic preset', () => {
  assert.ok(classicPreset, 'Expected an active Docusaurus classic preset');
});

test('Docusaurus serves docs from the site root', () => {
  assert.ok(classicPreset, 'Expected an active Docusaurus classic preset');
  assert.equal(classicPreset[1]?.docs?.routeBasePath, '/');
});

test('Docusaurus disables the blog', () => {
  assert.ok(classicPreset, 'Expected an active Docusaurus classic preset');
  assert.equal(classicPreset[1]?.blog, false);
});

test('Docusaurus identifies the Linkout organization', () => {
  assert.equal(siteConfig.organizationName, 'linkoutapp');
});

test('Docusaurus identifies the docs project', () => {
  assert.equal(siteConfig.projectName, 'docs');
});

test('broken Markdown links fail through the supported Markdown hook', () => {
  assert.equal(siteConfig.markdown?.hooks?.onBrokenMarkdownLinks, 'throw');
  assert.equal(siteConfig.onBrokenMarkdownLinks, undefined);
});

test('footer links only to public source resources that exist', () => {
  const sourceItems = siteConfig.themeConfig?.footer?.links
    ?.find((group) => group.title === 'Source')
    ?.items.map((item) => item.href);

  assert.deepEqual(sourceItems, [
    'https://github.com/linkoutapp/linkout-scraper',
    'https://github.com/linkoutapp/linkout-scraper/issues',
  ]);
});

test('patched transitive dependencies are explicitly scoped', () => {
  assert.equal(
    packageJson.overrides?.['minimatch@3.1.5']?.['brace-expansion'],
    '5.0.8',
  );
  assert.equal(
    packageJson.overrides?.['copy-webpack-plugin@11.0.0']?.[
      'serialize-javascript'
    ],
    '7.0.5',
  );
  assert.equal(
    packageJson.overrides?.['css-minimizer-webpack-plugin@5.0.1']?.[
      'serialize-javascript'
    ],
    '7.0.5',
  );
  assert.equal(
    packageJson.overrides?.['sockjs@0.3.24']?.uuid,
    '11.1.1',
  );
  assert.equal(
    packageJson.scripts?.['check:deps'],
    'npm ls brace-expansion serialize-javascript uuid --all --silent && npm audit --omit=dev',
  );
});

test('internal planning artifacts are not published', () => {
  const internalDocsPath = path.join(repositoryRoot, 'docs/superpowers');
  const internalFiles = fs.existsSync(internalDocsPath)
    ? fs.readdirSync(internalDocsPath, {recursive: true}).filter((entry) => {
        return fs.statSync(path.join(internalDocsPath, entry)).isFile();
      })
    : [];

  assert.deepEqual(internalFiles, []);
});

test('dark footer explicitly uses the Linkout page background', () => {
  const footerDarkRule = themeCss.match(
    /\.footer\.footer--dark\s*\{([^}]*)\}/,
  );

  assert.ok(
    footerDarkRule,
    'Expected custom.css to explicitly override .footer.footer--dark',
  );
  assert.match(
    footerDarkRule[1],
    /--ifm-footer-background-color:\s*var\(--linkout-background\)\s*;/,
  );
  assert.match(
    footerDarkRule[1],
    /background-color:\s*var\(--linkout-background\)\s*;/,
  );
});

test('introduction is mounted at the site root', () => {
  const introduction = docsByPath.get('docs/introduction.mdx');
  if (!introduction) {
    return;
  }

  assert.equal(
    frontmatterValue(introduction, 'slug'),
    '/',
    'Expected docs/introduction.mdx frontmatter to contain "slug: /"',
  );
});

for (const relativePath of requiredDocs.slice(1)) {
  test(`${relativePath} uses its file-derived route`, () => {
    const source = docsByPath.get(relativePath);
    if (!source) {
      return;
    }

    assert.equal(
      frontmatterValue(source, 'slug'),
      undefined,
      `Expected ${relativePath} not to override its file-derived route with slug`,
    );
  });
}

test('introduction or contributing links to the scraper repository', () => {
  const ownedDocs = [
    docsByPath.get('docs/introduction.mdx'),
    docsByPath.get('docs/contributing.mdx'),
  ].join('\n');

  assert.ok(
    ownedDocs.includes('github.com/linkoutapp/linkout-scraper'),
    'Expected introduction.mdx or contributing.mdx to link to github.com/linkoutapp/linkout-scraper',
  );
});

for (const [relativePath, requiredText] of [
  [
    'docs/getting-started/installation.mdx',
    'npm install linkout-scraper --save',
  ],
  ['docs/getting-started/installation.mdx', 'LINKOUT_CHROME_URL'],
  ['docs/interfaces/cli.mdx', 'npx linkout-mcp'],
  ['docs/interfaces/mcp.mdx', 'linkedin_get_profile'],
  ['docs/workflows/action-policy.mdx', 'CONFIRMATION_REQUIRED'],
]) {
  test(`${relativePath} includes ${requiredText}`, () => {
    assert.ok(
      docsByPath.get(relativePath).includes(requiredText),
      `Expected ${relativePath} to include "${requiredText}"`,
    );
  });
}

test('authentication tells users to sign in to LinkedIn manually', () => {
  assert.match(
    docsByPath.get('docs/getting-started/authentication.mdx'),
    /sign in to linkedin manually/i,
  );
});

test('safety documentation does not promise account safety', () => {
  assert.match(
    docsByPath.get('docs/operations/safety.mdx'),
    /does not guarantee account safety/i,
  );
});

test('documentation does not claim automation is undetectable', () => {
  assert.doesNotMatch(corpus, /undetectable/i);
});

test('documentation does not claim automation is guaranteed safe', () => {
  assert.doesNotMatch(corpus, /guaranteed safe/i);
});
