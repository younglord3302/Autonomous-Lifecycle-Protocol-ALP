import { defineConfig } from 'vitepress'
import { alp, ebnf } from './langs'

export default defineConfig({
  title: "ALP",
  description: "Autonomous Lifecycle Protocol",
  markdown: {
    code: {
      shiki: {
        languages: [alp, ebnf],
      },
    },
  },
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/cli' },
      { text: 'Specification', link: '/spec/01-overview' },
      { text: 'Releases', link: '/releases' }
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
        text: 'Specification',
        items: [
          { text: '1. Overview', link: '/spec/01-overview' },
          { text: '2. Syntax', link: '/spec/02-syntax' },
          { text: '3. Protocol Objects', link: '/spec/03-protocol-objects' },
          { text: '4. Lifecycle', link: '/spec/04-lifecycle' },
          { text: '5. Engines', link: '/spec/05-engines' },
          { text: '6. Memory Model', link: '/spec/06-memory' },
          { text: '7. Dependency Graph', link: '/spec/07-dependency-graph' },
          { text: '8. Agent Model', link: '/spec/08-agent-model' },
          { text: '9. Directory Structure', link: '/spec/09-directory-structure' },
          { text: '10. Versioning', link: '/spec/10-versioning' },
          { text: '11. Plugin System', link: '/spec/11-plugins' },
          { text: '12. Expressions (ALPEL)', link: '/spec/12-expressions' },
          { text: '13. Multi-Project', link: '/spec/13-multi-project' },
          { text: '14. Plugin Registry', link: '/spec/14-plugin-registry' },
          { text: '15. Formal Grammar', link: '/spec/15-formal-grammar' },
          { text: '16. Compliance', link: '/spec/16-compliance' },
          { text: '17. Scheduling', link: '/spec/17-scheduling' },
          { text: '18. Contracts', link: '/spec/18-contracts' },
          { text: '19. Encrypted Vault', link: '/spec/19-vault' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/younglord3302/Autonomous-Lifecycle-Protocol-ALP' }
    ]
  }
})
