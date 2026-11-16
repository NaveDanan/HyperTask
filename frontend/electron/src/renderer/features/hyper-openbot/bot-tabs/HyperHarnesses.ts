// Adapted from OpenBot shared/harnesses.json. Copyright (c) 2026 CopilotKit. MIT.
export const HYPER_EXTERNAL_HARNESSES = [
  {
    "id": "crewai",
    "name": "CrewAI",
    "summary": "Crews of agents with roles and tasks."
  },
  {
    "id": "llamaindex",
    "name": "LlamaIndex",
    "summary": "Agents built around your own documents."
  },
  {
    "id": "agno",
    "name": "Agno",
    "summary": "Fast, small, and multi-modal."
  },
  {
    "id": "langgraph",
    "name": "LangChain",
    "summary": "Agents built with LangChain, on any model."
  },
  {
    "id": "google-adk",
    "name": "Google ADK",
    "summary": "Google's agent kit. Gemini first, any model after."
  },
  {
    "id": "antigravity",
    "name": "Google Antigravity",
    "summary": "Google's agentic harness. Plans, edits and runs things itself."
  },
  {
    "id": "pydantic-ai",
    "name": "Pydantic AI",
    "summary": "Typed agents, validated in and out."
  },
  {
    "id": "microsoft-agent-framework",
    "name": "Microsoft Agent Framework",
    "summary": "Microsoft's, model-agnostic by design."
  },
  {
    "id": "claude-agent-sdk",
    "name": "Claude Agent SDK",
    "summary": "Anthropic's own agent loop, speaking AG-UI."
  },
  {
    "id": "strands",
    "name": "AWS Strands",
    "summary": "Amazon's. Bedrock first, any model after."
  },
  {
    "id": "ag2",
    "name": "AG2",
    "summary": "The AutoGen line, continued."
  },
  {
    "id": "langroid",
    "name": "Langroid",
    "summary": "Multi-agent, deliberately small."
  },
  {
    "id": "byo-url",
    "name": "An agent you already run",
    "summary": "Anything else that speaks AG-UI. Give it its address."
  }
] as const;
