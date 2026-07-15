import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "ALP",
  description: "Autonomous Lifecycle Protocol",
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/cli' },
      { text: 'Specification', link: '/spec/01-overview' }
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'CLI Usage', link: '/guide/cli' },
          { text: 'SDKs', link: '/guide/sdk' }
        ]
      },
      {
        text: 'Ecosystem & Execution (V2)',
        items: [
          { text: 'Execution Engine (alp run)', link: '/execution-engine' },
          { text: 'CLI Verification & Tools', link: '/cli-tools' },
          { text: 'MCP Server', link: '/mcp-server' },
          { text: 'VS Code Extension', link: '/vscode-extension' }
        ]
      },
      {
        text: 'Language Spec',
        items: [
          { text: 'Objects', link: '/objects' },
          { text: 'Syntax', link: '/syntax' },
          { text: 'References', link: '/references' }
        ]
      },
      {
        text: 'Specification',
        items: [
          { text: '1. Overview', link: '/spec/01-overview' },
          { text: '2. Core Syntax', link: '/spec/02-syntax' },
          { text: '3. Project & Feature', link: '/spec/03-project-feature' },
          { text: '4. Tasks', link: '/spec/04-tasks' },
          { text: '5. Workflows', link: '/spec/05-workflows' },
          { text: '6. Dependencies', link: '/spec/06-dependencies' },
          { text: '7. Goals', link: '/spec/07-goals' },
          { text: '8. Agents', link: '/spec/08-agents' },
          { text: '9. Memory', link: '/spec/09-memory' },
          { text: '10. State', link: '/spec/10-state' },
          { text: '11. Rule & Decision', link: '/spec/11-rule-decision' },
          { text: '12. Plugins', link: '/spec/12-plugins' },
          { text: '13. Multi-Project', link: '/spec/13-multi-project' },
          { text: '14. Expressions', link: '/spec/14-expressions' },
          { text: '15. Schema Validation', link: '/spec/15-schema-validation' },
          { text: '16. Compliance', link: '/spec/16-compliance' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/alp-protocol/alp' }
    ]
  }
})
