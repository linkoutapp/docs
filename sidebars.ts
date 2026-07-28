import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'introduction',
    {
      type: 'category',
      label: 'Getting started',
      items: [
        'getting-started/requirements',
        'getting-started/installation',
        'getting-started/authentication',
        'getting-started/first-action',
      ],
    },
    {
      type: 'category',
      label: 'Actions',
      items: ['actions/services', 'workflows/action-policy'],
    },
    {
      type: 'category',
      label: 'Interfaces',
      items: [
        'interfaces/cli',
        'interfaces/node-api',
        'interfaces/mcp',
        'interfaces/agent-plugins',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: ['architecture/runtime'],
    },
    {
      type: 'category',
      label: 'Operations',
      items: ['operations/troubleshooting', 'operations/safety'],
    },
    'contributing',
  ],
};

export default sidebars;
