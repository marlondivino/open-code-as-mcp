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
    const vector = await getEmbedding(info);
    
    const data = [{
      vector,
      text: info,
      category,
      timestamp: new Date().toISOString()
    }];

    if (!table) {
      table = await db.createTable(TABLE_NAME, data);
    } else {
      await table.add(data);
    }

    return {
      content: [{ type: "text", text: `Learned and stored in semantic memory: "${info}"` }],
    };
  }

  if (name === "refine_prompt") {
    const prompt = args?.prompt as string;
    let contextExtra = "";

    console.error(`Refining prompt: ${prompt.substring(0, 50)}...`);

    // Try to search for relevant memories
    if (table) {
      try {
        const queryVector = await getEmbedding(prompt);
        const results = await table.vectorSearch(queryVector).limit(3).toArray();
        
        if (results.length > 0) {
          contextExtra = "\n[Context Retrieved from Memory]:\n" + 
            results.map((r: any) => `- ${r.text}`).join("\n");
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
          text: `[Refined Prompt]: ${prompt}\n${contextExtra}\n\n(Antigravity can now use the information above to generate a more precise response)`,
        },
      ],
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
