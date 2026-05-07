# OpenCode MCP Server for Antigravity

This repository contains the **OpenCode MCP Server**, a server based on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) designed to act as a right-hand assistant for **Antigravity** in development and software architecture tasks.

The main goal of this MCP is to save tokens in complex Antigravity tasks by allowing OpenCode to refine prompts and perform preliminary analysis before sending the final instructions to the main model.

## Features

- **Prompt Refinement**: Transforms vague prompts into detailed and technical instructions.
- **Development Support**: Assists in bug fixing and implementing new features with a focus on efficiency.
- **Semantic Memory**: Stores and retrieves technical context to enrich prompts.

## Prerequisites

Before starting, you need to set up the development environment. We recommend using **NVM (Node Version Manager)** to manage Node.js versions on Windows.

### 1. NVM and Node.js Installation (Windows)

1. Download the `nvm-setup.exe` installer from [nvm-windows](https://github.com/coreybutler/nvm-windows/releases).
2. Follow the installation instructions.
3. Open a new **PowerShell** terminal and install the recommended Node.js version:
   ```powershell
   nvm install 22
   nvm use 22
   ```

### 2. Ollama Installation (For Semantic Memory)

Ollama is required to generate local embeddings.

1. Open **PowerShell** as Administrator and run:
   ```powershell
   winget install ollama
   ```
2. After installation, restart the terminal and download the memory model:
   ```powershell
   ollama pull nomic-embed-text
   ```

### 3. Verify Installation

Check if the tools are ready in **PowerShell**:

```powershell
node -v # Should return v22.x.x or higher
ollama --version
```

## Project Installation and Configuration

Follow the steps below to configure the OpenCode MCP Server using **PowerShell**:

1. **Clone the repository:**

   ```powershell
   git clone <repository-url>
   cd open-code-as-mcp
   ```

2. **Install dependencies:**

   ```powershell
   npm install
   ```

3. **Build the project:**
   ```powershell
   npm run build
   ```

## Antigravity Configuration

To integrate this MCP server with Antigravity, you must choose between **Local** mode (running on the same machine) or **Remote** mode (running on a server/cloud).

### Option A: Local Configuration (Stdio)

Use this option if the server is on the same machine as the client.

#### Global Memory (Default)

Memory will be shared across all projects and stored in the server folder.

```json
{
  "mcpServers": {
    "opencode": {
      "command": "node",
      "args": ["D:/IA/MCP/open-code-as-mcp/build/index.js"]
    }
  }
}
```

#### Per-Project Memory (Recommended)

For each project to have its own isolated memory inside the project's `.mcp_memory` folder:

```json
{
  "mcpServers": {
    "opencode": {
      "command": "node",
      "args": ["D:/IA/MCP/open-code-as-mcp/build/index.js"],
      "env": {
        "MCP_MEMORY_PATH": ".mcp_memory/vectors"
      }
    }
  }
}
```

_Note: Be sure to add `.mcp_memory/` to your `.gitignore` if you don't want to version the database._

### Option B: Remote Configuration (SSE)

Use this option if the server is running remotely. The server must be started with SSE mode active.

```json
{
  "mcpServers": {
    "opencode": {
      "url": "http://your-remote-server:3000/sse"
    }
  }
}
```

_Note: Ensure that the port and IP are accessible if using remote mode._

## Automatic Usage in Antigravity

To ensure Antigravity uses this MCP correctly, configure the following rules in your **System Prompt**:

# Antigravity Global Rules

1. **Prompt Refinement**: Whenever the user sends a request, first use `opencode:refine_prompt`.
2. **Context Enrichment**: Upon receiving the refined prompt, validate if there are technical terms that require additional lookup in semantic memory.
3. **Continuous Learning**: After successfully implementing a complex feature or a non-obvious bug fix, use `opencode:learn_context` to persist technical knowledge.

## Available Tools

The OpenCode MCP provides the following tools:

### 1. `refine_prompt`

Refines a development prompt to make it clearer and more efficient.

- **Arguments:**
  - `prompt`: (string) The original prompt that needs refinement.

### 2. `learn_context`

Memorizes important information (preference, technical rule, context) for future use in semantic memory.

- **Arguments:**
  - `information`: (string) The information to be remembered.
  - `category`: (string, optional) Information category (e.g., 'preference', 'architecture', 'style').

## Remote Access (SSE)

The server supports remote access via **SSE (Server-Sent Events)**. To run in remote mode in **PowerShell**, use:

### Running in remote mode:

```powershell
$env:MCP_MODE="sse"; $env:PORT="3000"; npm start
```

## Development

To run the server in development mode with hot-reload in **PowerShell**:

```powershell
npm run dev
```

## Debugging

You can test the server locally by running in **PowerShell**:

```powershell
node build/test-mcp.js
```

## Benefits of OpenCode MCP

1. **Token Savings**: By refining prompts locally, we reduce the context load sent to Antigravity.
2. **Enriched Context**: OpenCode can access local files and provide richer context for Antigravity.
3. **Agility**: Fast responses for refinement tasks.

---

_Developed with the support of Gemini CLI._
