import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import ollama from "ollama";
import * as lancedb from "@lancedb/lancedb";
import path from "path";
import fs from "fs";

// Memory Settings
const getDbPath = () => {
  if (process.env.MCP_MEMORY_PATH) {
    return path.isAbsolute(process.env.MCP_MEMORY_PATH) 
      ? process.env.MCP_MEMORY_PATH 
      : path.join(process.cwd(), process.env.MCP_MEMORY_PATH);
  }
  return path.join(process.cwd(), ".data", "vectors");
};

const DB_PATH = getDbPath();
const TABLE_NAME = "memories";
const EMBEDDING_MODEL = "nomic-embed-text";

// Ensures the base directory exists
const ensureDir = (p: string) => {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

let db: lancedb.Connection;
let table: lancedb.Table;

async function initDB() {
  ensureDir(DB_PATH);
  console.error(`Starting database at: ${DB_PATH}`);
  db = await lancedb.connect(DB_PATH);
  try {
    table = await db.openTable(TABLE_NAME);
  } catch {
    // If table doesn't exist, create it with an initial schema
    // Note: LanceDB infers the schema from the first record
    console.error("Memory table not found, it will be created on the first learning.");
  }
}

async function getEmbedding(text: string): Promise<number[]> {
  const response = await ollama.embed({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.embeddings[0]!;
}

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
              description: "The original prompt that needs refinement.",
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "learn_context") {
    const info = args?.information as string;
    const category = (args?.category as string) || "general";
    
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

    // Try to fetch relevant memories
    if (table) {
      const queryVector = await getEmbedding(prompt);
      const results = await table.vectorSearch(queryVector).limit(3).toArray();
      
      if (results.length > 0) {
        contextExtra = "\n[Context Retrieved from Memory]:\n" + 
          results.map((r: any) => `- ${r.text}`).join("\n");
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

async function main() {
  await initDB();
  const mode = process.env["MCP_MODE"] || "stdio";

  if (mode === "sse") {
    const app = express();
    app.use(express.json()); // Required for handlePostMessage
    const port = process.env["PORT"] || 3000;
    
    let transport: SSEServerTransport | null = null;

    app.get("/sse", async (req, res) => {
      console.error("New SSE connection established");
      transport = new SSEServerTransport("/messages", res);
      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).send("No active SSE session");
      }
    });

    app.listen(port, () => {
      console.error(`OpenCode MCP Server (SSE) running on port ${port}`);
      console.error(`SSE endpoint: http://localhost:${port}/sse`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("OpenCode MCP Server (Stdio) running");
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
