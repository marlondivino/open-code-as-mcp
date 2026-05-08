# OpenCode MCP Server for Antigravity

This repository contains the **OpenCode MCP Server**, a server based on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) designed to act as a right-hand assistant for **Antigravity** in development and software architecture tasks.

The main goal of this MCP is to save tokens in complex Antigravity tasks by allowing OpenCode to refine prompts and perform preliminary analysis before sending the final instructions to the main model.

## Features

- **Prompt Refinement**: Transforms vague prompts into detailed and technical instructions.
- **Development Support**: Assists in bug fixing and implementing new features with a focus on efficiency.
- **Semantic Memory**: Stores and retrieves technical context using **Semantic Chunking**, **Category Filtering**, and **XML Formatting** to maximize LLM precision and minimize token usage.

## Architecture

The OpenCode MCP Server acts as an orchestration layer between the AI Client and local specialized tools.

```mermaid
graph TD
    Client["AI Client (Antigravity/Claude)"] -- "MCP Protocol (Stdio/HTTP)" --> Server["OpenCode MCP Server"]

    subgraph "OpenCode Engine"
        Server --> Tools["Tools: refine_prompt / learn_context"]
        Tools --> Memory["Memory Manager"]
    end

    subgraph "Local Infrastructure"
        Memory -- "Store/Search" --> LDB[("LanceDB Vector Store")]
        Memory -- "Generate Embeddings" --> OLL["Ollama: nomic-embed-text"]
    end

    Server -- "Refined Prompt + Context" --> Client
```

### The Process Flow

```mermaid
sequenceDiagram
    participant User as User / Developer
    participant AG as AI Client (Antigravity)
    participant OC as OpenCode MCP Server
    participant LDB as LanceDB (Memory)
    participant OLL as Ollama (Embeddings)

    User->>AG: "How do I fix the auth bug?"
    Note over AG: Rule 1: Notify User & Refine
    AG->>User: "Refining with OpenCode for precision..."
    AG->>OC: refine_prompt("How do I fix the auth bug?")

    OC->>OLL: Generate embedding for query
    OLL-->>OC: Vector representation

    OC->>LDB: Vector search for top-relevant context
    LDB-->>OC: Snippets: "Auth uses JWT", "Secret in .env"

    Note over OC: Format results as XML
    OC-->>AG: "How do fix... + <semantic_memory>Snippets...</semantic_memory>"

    Note over AG: Generate high-precision answer
    AG->>User: Technical solution with codebase context
```

## Technology Stack

The solution is built using a modern and efficient stack designed for high performance and local privacy:

- **[OpenCode](https://opencode.ai/)**: The core orchestration engine that manages tool execution, prompt refinement logic, and semantic memory integration.
- **[Model Context Protocol (MCP)](https://modelcontextprotocol.io/)**: The standard protocol for connecting AI models to local/remote data and tools.
- **[LanceDB](https://lancedb.com/)**: A serverless, high-performance vector database that allows for incredibly fast semantic searches without the overhead of a traditional database server.
- **[Ollama](https://ollama.com/)**: Orchestrates local AI models. We use `nomic-embed-text` to generate high-quality vector embeddings locally, ensuring your technical data never leaves your machine.
- **[TypeScript](https://www.typescriptlang.org/) & [Node.js](https://nodejs.org/)**: Provides a type-safe and performant runtime environment for the server logic.
- **[Express](https://expressjs.com/)**: Used for the Remote Mode (HTTP/SSE), providing a robust foundation for the Streamable HTTP transport.

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

For each project to have its own isolated memory inside the project's `.mcp_memory` folder.

> [!IMPORTANT]
> Always use **absolute paths** in the `MCP_MEMORY_PATH` environment variable when configuring the server in a global MCP config (like Claude Desktop). This ensures the server finds the correct folder regardless of the current working directory.

```json
{
  "mcpServers": {
    "opencode": {
      "command": "node",
      "args": ["D:/IA/MCP/open-code-as-mcp/build/index.js"],
      "env": {
        "MCP_MEMORY_PATH": "D:/IA/MCP/open-code-as-mcp/.mcp_memory/vectors"
      }
    }
  }
}
```

_Note: Be sure to add `.mcp_memory/` to your `.gitignore` if you don't want to version the database._

> [!TIP]
> Ensure **Ollama** is running and you have downloaded the model with `ollama pull nomic-embed-text`.

### Option B: Remote Configuration (Streamable HTTP)

Use this option if the server is running remotely. The server uses the modern **Streamable HTTP** transport, which is more robust and efficient.

```json
{
  "mcpServers": {
    "opencode": {
      "url": "http://your-remote-server:3000/mcp"
    }
  }
}
```

_Note: The server also maintains backward compatibility for legacy clients at `http://your-remote-server:3000/sse`._

## Automatic Usage and Global Rules

To ensure Antigravity consistently follows best practices, the **Global Rules** are stored in two key locations:

1.  **Global Level (Windows)**: Inside the `GEMINI.md` file, located in your user profile: `%USERPROFILE%\.gemini\GEMINI.md` (a copy is available in this repo as [GEMINI.md](GEMINI.md)).
2.  **Project Level**: Inside the `.cursorrules` file in the root of this repository.

### Access via Environment Variable

You can reference the global rules path by setting an environment variable in your terminal or system configuration:

```powershell
$env:ANTIGRAVITY_RULES_PATH = "$HOME\.gemini\GEMINI.md"
```

### The Rules

To ensure Antigravity uses this MCP correctly, configure the following rules in your **System Prompt**:

# Antigravity Global Rules

1. **Prompt Refinement**: Whenever the user sends a request, first announce to the user: *"Refining your request with OpenCode for technical precision..."*, then use `opencode:refine_prompt`.
2. **Context Enrichment**: Upon receiving the refined prompt, validate if there are technical terms or project patterns that require additional lookup in semantic memory. Mention if you are pulling specific context from OpenCode memory.
3. **Continuous Learning**: After successfully implementing a complex feature, use `opencode:learn_context`. Briefly inform the user that this knowledge is being persisted in OpenCode's semantic memory.

> [!TIP]
> You can find the raw version of these rules in the [.cursorrules](.cursorrules) or [GEMINI.md](GEMINI.md) file for easy copying into your System Prompt.

## Available Tools

The OpenCode MCP provides the following tools:

### 1. `refine_prompt`

Refines a development prompt to make it clearer and more efficient, injecting targeted context via XML tags.

- **Arguments:**
  - `prompt`: (string) The original prompt that needs refinement.
  - `categoryFilter`: (string, optional) Optional category to filter memories (e.g., 'architecture', 'style') to increase precision and reduce token usage.

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

## Token Efficiency Validation

A technical analysis was performed to measure the efficiency of semantic retrieval vs. full-context injection.

### Test Scenario: Auth Middleware Migration

- **Knowledge Base**: Complex technical documentation for migrating session-based authentication to JWT, including security rules and legacy fallback patterns (~8,000 characters).
- **Query**: "How to implement the JWT fallback for legacy session endpoints?"

### Results

| Metric                | Traditional (Full Context) | MCP (Semantic Retrieval) | Efficiency Gain   |
| :-------------------- | :------------------------- | :----------------------- | :---------------- |
| **Characters Sent**   | ~8,000                     | ~950                     | **~88% Savings**  |
| **Tokens (Est. 1:4)** | ~2,000                     | ~238                     | **~88% Savings**  |
| **Response Accuracy** | Medium (Noise risk)        | High (Exact context)     | Qualitative Boost |

**Why is it more efficient?**
OpenCode MCP implements a local **RAG (Retrieval-Augmented Generation)** architecture. Instead of sending 100% of your documentation or source files, it uses vector embeddings to identify and inject only the **Top relevant snippets**, drastically reducing the input token count for the main model.

### Advanced Optimizations

To maximize efficiency, the server actively implements:

1. **Semantic Chunking**: Large knowledge blocks are automatically split into smaller, focused chunks before being embedded. This ensures only the exact relevant paragraph is retrieved.
2. **Category Filtering**: Queries can be scoped to specific categories (e.g., `architecture` or `style`), significantly reducing noise and allowing the result limit to be tightened.
3. **XML Context Formatting**: Retrieved memories are injected into the prompt using strict XML tags (`<semantic_memory>` and `<context_item>`). This aligns with how modern LLMs best parse context, eliminating attention dilution.

## Benefits of OpenCode MCP

1. **Token Savings**: By refining prompts locally, we reduce the context load sent to Antigravity.
2. **Enriched Context**: OpenCode can access local files and provide richer context for Antigravity.
3. **Agility**: Fast responses for refinement tasks.

---
