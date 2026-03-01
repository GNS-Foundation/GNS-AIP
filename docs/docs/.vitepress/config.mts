import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'GNS-AIP',
  description: 'Agent Identity Protocol — Give your AI agents provable identity, delegation, and compliance',

  head: [
    ['link', { rel: 'icon', href: '/logo.png' }],
    ['meta', { name: 'theme-color', content: '#0A1628' }],
    ['meta', { property: 'og:title', content: 'GNS-AIP Developer Docs' }],
    ['meta', { property: 'og:description', content: 'Agent Identity Protocol — provable identity for AI agents' }],
    ['meta', { property: 'og:image', content: '/logo.png' }],
  ],
  locales: {
    root: {
      label: 'EN',
      lang: 'en',
    },
    it: {
      label: 'IT',
      lang: 'it',
      link: '/it/',
      themeConfig: {
        nav: [
          { text: 'Guida', link: '/it/guide/what-is-gns-aip' },
          {
            text: 'SDK', items: [
              { text: 'TypeScript', link: '/it/sdk/typescript/' },
              { text: 'Python', link: '/it/sdk/python/' },
            ]
          },
          {
            text: 'Integrazioni', items: [
              { text: 'LangChain', link: '/it/integrations/langchain/' },
              { text: 'OpenAI Agents', link: '/it/integrations/openai/' },
              { text: 'Vercel AI', link: '/it/integrations/vercel/' },
              { text: 'CrewAI', link: '/it/integrations/crewai/' },
              { text: 'AutoGen', link: '/it/integrations/autogen/' },
            ]
          },
          { text: 'Concetti', link: '/it/concepts/identity' },
          { text: 'API', link: '/it/api/' },
          { text: 'GitHub', link: 'https://github.com/GNS-Foundation/GNS-AIP' },
          { text: 'EN', link: '/' },
          { text: 'IT', link: '/it/' },
          { text: 'ES', link: '/es/' },
        ],
        sidebar: {
          '/it/guide/': [
            {
              text: 'Introduzione',
              items: [
                { text: 'Cos\'è GNS-AIP?', link: '/it/guide/what-is-gns-aip' },
                { text: 'Avvio Rapido', link: '/it/guide/quickstart' },
                { text: 'Architettura', link: '/it/guide/architecture' },
              ],
            },
            {
              text: 'Flussi Principali',
              items: [
                { text: 'Provisioning', link: '/it/guide/provisioning' },
                { text: 'Delega', link: '/it/guide/delegation' },
                { text: 'Punteggio di Conformità', link: '/it/guide/compliance' },
                { text: 'Breadcrumb', link: '/it/guide/breadcrumbs' },
              ],
            },
          ],
          '/it/sdk/': [
            {
              text: 'SDK TypeScript',
              items: [
                { text: 'Panoramica', link: '/it/sdk/typescript/' },
                { text: 'Installazione', link: '/it/sdk/typescript/install' },
                { text: 'Client', link: '/it/sdk/typescript/client' },
                { text: 'Tipi', link: '/it/sdk/typescript/types' },
              ],
            },
            {
              text: 'SDK Python',
              items: [
                { text: 'Panoramica', link: '/it/sdk/python/' },
                { text: 'Installazione', link: '/it/sdk/python/install' },
                { text: 'Client', link: '/it/sdk/python/client' },
                { text: 'Modelli', link: '/it/sdk/python/models' },
              ],
            },
          ],
          '/it/integrations/': [
            {
              text: 'Integrazioni Framework',
              items: [
                { text: 'LangChain', link: '/it/integrations/langchain/' },
                { text: 'OpenAI Agents SDK', link: '/it/integrations/openai/' },
                { text: 'Vercel AI SDK', link: '/it/integrations/vercel/' },
                { text: 'CrewAI', link: '/it/integrations/crewai/' },
                { text: 'AutoGen / AG2', link: '/it/integrations/autogen/' },
              ],
            },
          ],
          '/it/concepts/': [
            {
              text: 'Concetti Fondamentali',
              items: [
                { text: 'Identità Agente', link: '/it/concepts/identity' },
                { text: 'Catene di Delega', link: '/it/concepts/delegation' },
                { text: 'Proof-of-Trajectory', link: '/it/concepts/proof-of-trajectory' },
                { text: 'Livelli di Conformità', link: '/it/concepts/compliance-tiers' },
                { text: 'Vincolo Territoriale', link: '/it/concepts/territorial-binding' },
                { text: 'Provenienza a Tre Livelli', link: '/it/concepts/three-layer-provenance' },
              ],
            },
          ],
          '/it/api/': [
            {
              text: 'Riferimento API',
              items: [
                { text: 'Panoramica', link: '/it/api/' },
                { text: 'POST /agents/provision', link: '/it/api/provision' },
                { text: 'POST /agents/delegate', link: '/it/api/delegate' },
                { text: 'GET /agents/:id/manifest', link: '/it/api/manifest' },
                { text: 'GET /agents/:id/compliance', link: '/it/api/compliance' },
                { text: 'POST /agents/:id/breadcrumbs', link: '/it/api/breadcrumbs' },
              ],
            },
          ],
        },
        footer: {
          message: 'Rilasciato sotto Licenza MIT.',
          copyright: '© 2026 GNS Foundation · Globe Crumbs Inc. · ULISSY s.r.l.',
        },
      },
    },
    es: {
      label: 'ES',
      lang: 'es',
      link: '/es/',
      themeConfig: {
        nav: [
          { text: 'Guía', link: '/es/guide/what-is-gns-aip' },
          {
            text: 'SDKs', items: [
              { text: 'TypeScript', link: '/es/sdk/typescript/' },
              { text: 'Python', link: '/es/sdk/python/' },
            ]
          },
          {
            text: 'Integraciones', items: [
              { text: 'LangChain', link: '/es/integrations/langchain/' },
              { text: 'OpenAI Agents', link: '/es/integrations/openai/' },
              { text: 'Vercel AI', link: '/es/integrations/vercel/' },
              { text: 'CrewAI', link: '/es/integrations/crewai/' },
              { text: 'AutoGen', link: '/es/integrations/autogen/' },
            ]
          },
          { text: 'Conceptos', link: '/es/concepts/identity' },
          { text: 'API', link: '/es/api/' },
          { text: 'GitHub', link: 'https://github.com/GNS-Foundation/GNS-AIP' },
          { text: 'EN', link: '/' },
          { text: 'IT', link: '/it/' },
          { text: 'ES', link: '/es/' },
        ],
        sidebar: {
          '/es/guide/': [
            {
              text: 'Introducción',
              items: [
                { text: '¿Qué es GNS-AIP?', link: '/es/guide/what-is-gns-aip' },
                { text: 'Inicio Rápido', link: '/es/guide/quickstart' },
                { text: 'Arquitectura', link: '/es/guide/architecture' },
              ],
            },
            {
              text: 'Flujos Principales',
              items: [
                { text: 'Aprovisionamiento', link: '/es/guide/provisioning' },
                { text: 'Delegación', link: '/es/guide/delegation' },
                { text: 'Puntuación de Cumplimiento', link: '/es/guide/compliance' },
                { text: 'Breadcrumbs', link: '/es/guide/breadcrumbs' },
              ],
            },
          ],
          '/es/sdk/': [
            {
              text: 'SDK TypeScript',
              items: [
                { text: 'Descripción', link: '/es/sdk/typescript/' },
                { text: 'Instalación', link: '/es/sdk/typescript/install' },
                { text: 'Cliente', link: '/es/sdk/typescript/client' },
                { text: 'Tipos', link: '/es/sdk/typescript/types' },
              ],
            },
            {
              text: 'SDK Python',
              items: [
                { text: 'Descripción', link: '/es/sdk/python/' },
                { text: 'Instalación', link: '/es/sdk/python/install' },
                { text: 'Cliente', link: '/es/sdk/python/client' },
                { text: 'Modelos', link: '/es/sdk/python/models' },
              ],
            },
          ],
          '/es/integrations/': [
            {
              text: 'Integraciones de Frameworks',
              items: [
                { text: 'LangChain', link: '/es/integrations/langchain/' },
                { text: 'OpenAI Agents SDK', link: '/es/integrations/openai/' },
                { text: 'Vercel AI SDK', link: '/es/integrations/vercel/' },
                { text: 'CrewAI', link: '/es/integrations/crewai/' },
                { text: 'AutoGen / AG2', link: '/es/integrations/autogen/' },
              ],
            },
          ],
          '/es/concepts/': [
            {
              text: 'Conceptos Fundamentales',
              items: [
                { text: 'Identidad del Agente', link: '/es/concepts/identity' },
                { text: 'Cadenas de Delegación', link: '/es/concepts/delegation' },
                { text: 'Proof-of-Trajectory', link: '/es/concepts/proof-of-trajectory' },
                { text: 'Niveles de Cumplimiento', link: '/es/concepts/compliance-tiers' },
                { text: 'Vinculación Territorial', link: '/es/concepts/territorial-binding' },
                { text: 'Proveniencia de Tres Capas', link: '/es/concepts/three-layer-provenance' },
              ],
            },
          ],
          '/es/api/': [
            {
              text: 'Referencia API',
              items: [
                { text: 'Descripción', link: '/es/api/' },
                { text: 'POST /agents/provision', link: '/es/api/provision' },
                { text: 'POST /agents/delegate', link: '/es/api/delegate' },
                { text: 'GET /agents/:id/manifest', link: '/es/api/manifest' },
                { text: 'GET /agents/:id/compliance', link: '/es/api/compliance' },
                { text: 'POST /agents/:id/breadcrumbs', link: '/es/api/breadcrumbs' },
              ],
            },
          ],
        },
        footer: {
          message: 'Publicado bajo la Licencia MIT.',
          copyright: '© 2026 GNS Foundation · Globe Crumbs Inc. · ULISSY s.r.l.',
        },
      },
    },
  },
  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'GNS-AIP',
    nav: [
      { text: 'Guide', link: '/guide/what-is-gns-aip' },
      {
        text: 'SDKs', items: [
          { text: 'TypeScript', link: '/sdk/typescript/' },
          { text: 'Python', link: '/sdk/python/' },
        ]
      },
      {
        text: 'Integrations', items: [
          { text: 'LangChain', link: '/integrations/langchain/' },
          { text: 'OpenAI Agents', link: '/integrations/openai/' },
          { text: 'Vercel AI', link: '/integrations/vercel/' },
          { text: 'CrewAI', link: '/integrations/crewai/' },
          { text: 'AutoGen', link: '/integrations/autogen/' },
        ]
      },
      { text: 'Concepts', link: '/concepts/identity' },
      { text: 'API Reference', link: '/api/' },
      {
        text: 'GitHub',
        link: 'https://github.com/GNS-Foundation/GNS-AIP',
      },
      { text: 'EN', link: '/' },
      { text: 'IT', link: '/it/' },
      { text: 'ES', link: '/es/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is GNS-AIP?', link: '/guide/what-is-gns-aip' },
            { text: 'Quick Start', link: '/guide/quickstart' },
            { text: 'Architecture', link: '/guide/architecture' },
          ],
        },
        {
          text: 'Core Workflows',
          items: [
            { text: 'Provisioning', link: '/guide/provisioning' },
            { text: 'Delegation', link: '/guide/delegation' },
            { text: 'Compliance Scoring', link: '/guide/compliance' },
            { text: 'Breadcrumbs', link: '/guide/breadcrumbs' },
          ],
        },
      ],
      '/sdk/': [
        {
          text: 'TypeScript SDK',
          items: [
            { text: 'Overview', link: '/sdk/typescript/' },
            { text: 'Installation', link: '/sdk/typescript/install' },
            { text: 'Client', link: '/sdk/typescript/client' },
            { text: 'Types', link: '/sdk/typescript/types' },
          ],
        },
        {
          text: 'Python SDK',
          items: [
            { text: 'Overview', link: '/sdk/python/' },
            { text: 'Installation', link: '/sdk/python/install' },
            { text: 'Client', link: '/sdk/python/client' },
            { text: 'Models', link: '/sdk/python/models' },
          ],
        },
      ],
      '/integrations/': [
        {
          text: 'Framework Integrations',
          items: [
            { text: 'LangChain', link: '/integrations/langchain/' },
            { text: 'OpenAI Agents SDK', link: '/integrations/openai/' },
            { text: 'Vercel AI SDK', link: '/integrations/vercel/' },
            { text: 'CrewAI', link: '/integrations/crewai/' },
            { text: 'AutoGen / AG2', link: '/integrations/autogen/' },
          ],
        },
      ],
      '/concepts/': [
        {
          text: 'Core Concepts',
          items: [
            { text: 'Agent Identity', link: '/concepts/identity' },
            { text: 'Delegation Chains', link: '/concepts/delegation' },
            { text: 'Proof-of-Trajectory', link: '/concepts/proof-of-trajectory' },
            { text: 'Compliance Tiers', link: '/concepts/compliance-tiers' },
            { text: 'Territorial Binding', link: '/concepts/territorial-binding' },
            { text: 'Three-Layer Provenance', link: '/concepts/three-layer-provenance' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'POST /agents/provision', link: '/api/provision' },
            { text: 'POST /agents/delegate', link: '/api/delegate' },
            { text: 'GET /agents/:id/manifest', link: '/api/manifest' },
            { text: 'GET /agents/:id/compliance', link: '/api/compliance' },
            { text: 'POST /agents/:id/breadcrumbs', link: '/api/breadcrumbs' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/GNS-Foundation/GNS-AIP' },
    ],
    search: {
      provider: 'local',
    },
    editLink: {
      pattern: 'https://github.com/GNS-Foundation/GNS-AIP/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: '© 2026 GNS Foundation · Globe Crumbs Inc. · ULISSY s.r.l.',
    },
  },
})
