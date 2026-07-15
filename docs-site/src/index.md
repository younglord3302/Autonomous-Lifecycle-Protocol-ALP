---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "ALP"
  text: "The Autonomous Lifecycle Protocol"
  tagline: "The open standard for AI-driven software engineering. Write a spec, and let your agents build it."
  actions:
    - theme: brand
      text: Get Started
      link: '/guide/cli'
    - theme: alt
      text: View Language Spec
      link: '/objects'

features:
  - title: Execution Engine (V2)
    details: The `@alp/cli` natively executes tasks. Run `alp run` to topologically sort your dependencies, compile LLM context bundles, and verify completion.
  - title: Machine-Readable Graph
    details: ALP parses your .alp files into a Directed Acyclic Graph (DAG), tracking dependencies, blocked tasks, and architecture decisions in real time.
  - title: MCP Server Native
    details: Connect any AI IDE (Claude Desktop, Cursor) directly to your ALP workspace using the native `@alp/mcp-server` to allow agents to instantly pull context.
  - title: VS Code Language Server
    details: Built-in LSP support. Install `alp-vscode` to get IntelliSense, go-to-definition, and rich hover metadata while writing your protocol files.
---
