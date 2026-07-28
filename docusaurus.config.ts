import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type {Options, ThemeConfig} from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Linkout Docs',
  tagline: 'Local, visible-browser LinkedIn tools',
  favicon: 'img/linkout-mark.svg',

  url: 'https://docs.linkout.space',
  baseUrl: '/',
  organizationName: 'linkoutapp',
  projectName: 'docs',
  trailingSlash: false,
  onBrokenLinks: 'throw',

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/linkoutapp/docs/edit/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          changefreq: 'weekly',
          priority: 0.5,
        },
      } satisfies Options,
    ],
  ],

  themeConfig: {
    metadata: [
      {
        name: 'description',
        content:
          'Source-accurate documentation for Linkout and linkout-scraper.',
      },
      {property: 'og:type', content: 'website'},
      {property: 'og:site_name', content: 'Linkout Docs'},
    ],
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'Linkout',
      logo: {
        alt: 'Linkout',
        src: 'img/linkout-mark.svg',
      },
      items: [
        {
          to: '/getting-started/requirements',
          label: 'Get started',
          position: 'left',
        },
        {
          to: '/actions/services',
          label: 'Actions',
          position: 'left',
        },
        {
          to: '/interfaces/mcp',
          label: 'MCP',
          position: 'left',
        },
        {
          href: 'https://github.com/linkoutapp/linkout-scraper',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Get started',
              to: '/getting-started/requirements',
            },
            {
              label: 'CLI',
              to: '/interfaces/cli',
            },
            {
              label: 'Node API',
              to: '/interfaces/node-api',
            },
            {
              label: 'Safety',
              to: '/operations/safety',
            },
          ],
        },
        {
          title: 'Source',
          items: [
            {
              label: 'linkout-scraper',
              href: 'https://github.com/linkoutapp/linkout-scraper',
            },
            {
              label: 'Issues',
              href: 'https://github.com/linkoutapp/linkout-scraper/issues',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Linkout. MIT License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json'],
    },
  } satisfies ThemeConfig,
};

export default config;
