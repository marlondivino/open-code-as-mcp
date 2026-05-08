import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import ollama from "ollama";
import * as lancedb from "@lancedb/lancedb";
import path from "path";
import fs from "fs";

/**
 * Memory Configuration and Constants
 */
const getDbPath = () => {
  if (process.env.MCP_MEMORY_PATH) {
    return path.isAbsolute(process.env.MCP_MEMORY_PATH) 
      ? process.env.MCP_MEMORY_PATH 
      : path.resolve(process.cwd(), process.env.MCP_MEMORY_PATH);
  }
  return path.join(process.cwd(), ".data", "vectors");
};

const DB_PATH = getDbPath();
const TABLE_NAME = "memories";
const EMBEDDING_MODEL = "nomic-embed-text";

/**
 * Ensures that the base directory for a given path exists.
 * @param p - The file path to check.
 */
const ensureDir = (p: string) => {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    console.error(`Creating directory: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  }
};

let db: lancedb.Connection;
let table: lancedb.Table;

/**
 * Initializes the LanceDB vector database.
 * Connects to the database and attempts to open the memories table.
 */
async function initDB() {
  try {
    ensureDir(DB_PATH);
    console.error(`Initializing database at: ${DB_PATH}`);
    db = await lancedb.connect(DB_PATH);
    
    try {
      table = await db.openTable(TABLE_NAME);
      console.error(`Table "${TABLE_NAME}" loaded successfully.`);
    } catch {
      console.error("Memory table not found, it will be created on the first learning task.");
    }
  } catch (error) {
    console.error("Error initializing the database:", error);
    throw error;
  }
}

/**
 * Generates an embedding vector for the given text using Ollama.
 * @param text - The text to embed.
 * @returns A promise that resolves to an array of numbers representing the embedding.
 */
async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await ollama.embed({
      model: EMBEDDING_MODEL,
      input: text,
    });
    return response.embeddings[0]!;
  } catch (error: any) {
    console.error(`Error getting embedding from Ollama (Model: ${EMBEDDING_MODEL}):`, error.message);
    if (error.message.includes("not found")) {
      console.error(`HINT: Run 'ollama pull ${EMBEDDING_MODEL}' in your terminal.`);
    }
    throw new Error(`Ollama communication failure: ${error.message}`);
  }
}

/**
 * MCP Server instance configuration.
 */
const server = new Server(
  {
    name: "opencode-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Handler for listing available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "refine_prompt",
        description: "Refines a prompt using semantic memory to make it more contextual and efficient.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The original prompt that needs to be refined.",
            },
            categoryFilter: {
              type: "string",
              description: "Optional category to filter memories (e.g., 'architecture', 'style').",
            },
          },
          required: ["prompt"],
        },
      },
      {
        name: "learn_context",
        description: "Memorizes important information (preference, technical rule, context) for future use.",
        inputSchema: {
          type: "object",
          properties: {
            information: {
              type: "string",
              description: "The information to be remembered.",
            },
            category: {
              type: "string",
              description: "Information category (e.g., 'preference', 'architecture', 'style').",
            },
          },
          required: ["information"],
        },
      },
      {
        name: "search_memory",
        description: "Searches the semantic memory for specific information without refining a prompt.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query.",
            },
            category: {
              type: "string",
              description: "Optional category to filter search.",
            },
            limit: {
              type: "number",
              description: "Number of results to return (default: 5).",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "index_codebase",
        description: "Performs a deep scan of the project structure and key files to populate semantic memory.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The root path to index (defaults to current directory).",
            },
          },
        },
      },
    ],
  };
});

/**
 * Handler for tool execution requests.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "learn_context") {
    const info = args?.information as string;
    const category = (args?.category as string) || "general";
    
    console.error(`Learning new context: ${info.substring(0, 50)}...`);
    
    // Semantic Chunking: split by double newlines or large blocks
    const chunks = info.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 0);
    const data = [];
    
    for (const chunk of chunks) {
      const vector = await getEmbedding(chunk);
      data.push({
        vector,
        text: chunk,
        category,
        timestamp: new Date().toISOString()
      });
    }

    if (!table) {
      table = await db.createTable(TABLE_NAME, data);
    } else {
      await table.add(data);
    }

    return {
      content: [{ type: "text", text: `Learned and stored ${chunks.length} chunks in semantic memory.` }],
    };
  }

  if (name === "refine_prompt") {
    const prompt = args?.prompt as string;
    const categoryFilter = args?.categoryFilter as string;
    let contextExtra = "";

    console.error(`Refining prompt: ${prompt.substring(0, 50)}...`);

    // Try to search for relevant memories
    if (table) {
      try {
        const queryVector = await getEmbedding(prompt);
        let query = table.vectorSearch(queryVector);
        
        if (categoryFilter) {
          query = query.filter(`category = '${categoryFilter}'`);
        }
        
        const results = await query.limit(2).toArray();
        
        if (results.length > 0) {
          contextExtra = "\n<semantic_memory>\n" + 
            results.map((r: any) => `<context_item category="${r.category}">\n${r.text}\n</context_item>`).join("\n") +
            "\n</semantic_memory>";
          console.error(`Retrieved ${results.length} relevant memories.`);
        }
      } catch (error) {
        console.error("Error searching semantic memory:", error);
        contextExtra = "\n[Warning]: Could not retrieve memories at this time.";
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `${prompt}\n${contextExtra}`,
        },
      ],
    };
  }

  if (name === "search_memory") {
    const queryStr = args?.query as string;
    const category = args?.category as string;
    const limit = (args?.limit as number) || 5;

    if (!table) return { content: [{ type: "text", text: "Memory is currently empty." }] };

    const queryVector = await getEmbedding(queryStr);
    let query = table.vectorSearch(queryVector);
    if (category) query = query.filter(`category = '${category}'`);
    
    const results = await query.limit(limit).toArray();
    
    const response = results.map((r: any) => `[${r.category}] ${r.text}`).join("\n---\n");
    return {
      content: [{ type: "text", text: response || "No relevant memories found." }],
    };
  }

  if (name === "index_codebase") {
    const rootPath = (args?.path as string) || process.cwd();
    console.error(`Starting codebase indexing at: ${rootPath}`);
    
    // Recursive file listing helper
    const getFiles = (dir: string, allFiles: string[] = []) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file === "node_modules" || file === ".git" || file === ".data" || file === "dist" || file === "build") continue;
        const name = path.join(dir, file);
        if (fs.statSync(name).isDirectory()) {
          getFiles(name, allFiles);
        } else {
          allFiles.push(name);
        }
      }
      return allFiles;
    };

    const files = getFiles(rootPath);
    const structureSummary = `Project Structure at ${rootPath}:\n` + 
      files.map(f => path.relative(rootPath, f)).join("\n");

    // Learn the structure
    const queryVector = await getEmbedding(structureSummary);
    const data = [{
      vector: queryVector,
      text: structureSummary,
      category: "architecture",
      timestamp: new Date().toISOString()
    }];

    if (!table) {
      table = await db.createTable(TABLE_NAME, data);
    } else {
      await table.add(data);
    }

    return {
      content: [{ type: "text", text: `Indexed ${files.length} files. Project structure has been mapped to semantic memory.` }],
    };
  }

  throw new Error(`Tool not found: ${name}`);
});

/**
 * Main function to start the MCP server.
 * Supports both Stdio and Streamable HTTP transport modes.
 */
async function main() {
  await initDB();
  const mode = process.env["MCP_MODE"] || "stdio";

  if (mode === "sse") {
    const app = express();
    app.use(express.json());
    const port = process.env["PORT"] || 3000;
    
    const transport = new StreamableHTTPServerTransport();
    await server.connect(transport as any);

    app.all("/mcp", async (req, res) => {
      await transport.handleRequest(req, res, req.body);
    });

    // Backward compatibility for legacy /sse and /messages endpoints
    app.all("/sse", async (req, res) => {
      await transport.handleRequest(req, res, req.body);
    });
    app.all("/messages", async (req, res) => {
      await transport.handleRequest(req, res, req.body);
    });

    app.listen(port, () => {
      console.error(`OpenCode MCP Server (Streamable HTTP) running on port ${port}`);
      console.error(`MCP Endpoint: http://localhost:${port}/mcp`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("OpenCode MCP Server (Stdio) running");
  }
}

/**
 * Entry point with fatal error handling.
 */
main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
