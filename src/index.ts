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
import { LRUCache } from "lru-cache";

/**
 * Global Error Handling to prevent EOF crashes
 */
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('SIGINT', () => {
  console.error('Received SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

process.on('exit', (code) => {
  console.error(`Process exiting with code: ${code}`);
});

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

// Dynamic Configuration State
let dynamicConfig = {
  enableContext7: process.env.ENABLE_CONTEXT7 !== "false",
  context7ApiKey: process.env.CONTEXT7_API_KEY || "",
  useHybrid: process.env.USE_HYBRID === undefined || process.env.USE_HYBRID !== "false",
  localConfidenceThreshold: parseFloat(process.env.LOCAL_CONFIDENCE_THRESHOLD || "0.7")
};

// Context7 response cache (5 min default)
const context7Cache = new LRUCache<string, string>({
  max: 500,
  ttl: 1000 * 60 * 5,
});


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

    // Health check Ollama
    try {
      await ollama.list();
      console.error("Ollama connection verified.");
    } catch (err: any) {
      console.error("WARNING: Ollama is not reachable. Semantic features will fail.", err.message);
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
        description: "Refines a prompt using local semantic memory, a local AI model for rewriting, and real-time external documentation (Context7) to make it more contextual and efficient.",
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
      {
        name: "configure_context7",
        description: "Configures the Context7 integration dynamically. Allows enabling/disabling real-time documentation retrieval and setting the API key directly via Antigravity.",
        inputSchema: {
          type: "object",
          properties: {
            enable: {
              type: "boolean",
              description: "Set to true to enable Context7, false to disable.",
            },
            apiKey: {
              type: "string",
              description: "Optional. The Context7 API Key.",
            },
            useHybrid: {
              type: "boolean",
              description: "Optional. Set to true to enable hybrid mode (local first).",
            },
            threshold: {
              type: "number",
              description: "Optional. Set the confidence threshold for local hits (0-1).",
            },
          },
          required: ["enable"],
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

  if (name === "configure_context7") {
    const enable = args?.enable as boolean;
    const apiKey = args?.apiKey as string;
    const useHybrid = args?.useHybrid as boolean;
    const threshold = args?.threshold as number;

    dynamicConfig.enableContext7 = enable;
    if (apiKey) dynamicConfig.context7ApiKey = apiKey;
    if (useHybrid !== undefined) dynamicConfig.useHybrid = useHybrid;
    if (threshold !== undefined) dynamicConfig.localConfidenceThreshold = threshold;

    const statusMsg = `Context7 configuration updated successfully.\n` +
      `Status: ${enable ? 'ENABLED' : 'DISABLED'}\n` +
      `Hybrid Mode: ${dynamicConfig.useHybrid ? 'ENABLED' : 'DISABLED'}\n` +
      `Threshold: ${dynamicConfig.localConfidenceThreshold}\n` +
      `API Key: ${dynamicConfig.context7ApiKey ? 'Set' : 'Not Set'}`;
    console.error(statusMsg);

    return {
      content: [{ type: "text", text: statusMsg }],
    };
  }

  if (name === "refine_prompt") {
    const originalPrompt = args?.prompt as string;
    const categoryFilter = args?.categoryFilter as string;
    let contextExtra = "";

    console.error(`Refining prompt locally via Ollama: ${originalPrompt.substring(0, 50)}...`);

    let refinedPrompt = originalPrompt;
    let inferredTechnologies: string[] = [];

    // Step 1: Use local Ollama (opencode.ai) to refine the prompt and extract technologies
    try {
      const inferenceModel = process.env.MCP_INFERENCE_MODEL || 'llama3';
      const ollamaResponse = await ollama.generate({
        model: inferenceModel,
        prompt: `You are an expert software architect. Your task is to rewrite the following vague user prompt into a clear, highly detailed, and technical prompt. Also, identify any programming languages, frameworks, or libraries relevant to the prompt.
Return your response strictly in JSON format with the following keys:
"refinedPrompt": The rewritten, detailed prompt.
"technologies": An array of strings with the extracted technologies.

User Prompt: "${originalPrompt}"`,
        stream: false,
        format: "json"
      });
      
      const parsed = JSON.parse(ollamaResponse.response);
      if (parsed.refinedPrompt) refinedPrompt = parsed.refinedPrompt;
      if (parsed.technologies && Array.isArray(parsed.technologies)) {
        inferredTechnologies = parsed.technologies.map((t: string) => t.trim().toLowerCase());
      }
      console.error(`Local AI Refinement Success. Inferred Tech: ${inferredTechnologies.join(", ")}`);
    } catch (error: any) {
      console.error(`Local AI Refinement failed (Model: ${process.env.MCP_INFERENCE_MODEL || 'llama3'}). Error: ${error.message}`);
      if (error.message.includes("not found")) {
        console.error(`HINT: Run 'ollama pull ${process.env.MCP_INFERENCE_MODEL || 'llama3'}' to enable local refinement.`);
      }
    }

    // Step 2: Try to search for relevant local memories
    let isLocalHit = false;
    if (table) {
      try {
        const queryVector = await getEmbedding(refinedPrompt);
        let query = table.vectorSearch(queryVector);
        
        if (categoryFilter) {
          query = query.filter(`category = '${categoryFilter}'`);
        }
        
        // LanceDB returns results with _distance. 0 is perfect match, higher is less similar.
        // We approximate confidence as 1 - distance (normalized or clamped).
        const results = await query.limit(2).toArray();
        
        if (results.length > 0) {
          const topResult = results[0];
          // Heuristic: distance < 0.3 is usually a very strong hit
          const confidence = topResult._distance !== undefined ? Math.max(0, 1 - topResult._distance) : 1;
          
          if (dynamicConfig.useHybrid && confidence >= dynamicConfig.localConfidenceThreshold) {
            isLocalHit = true;
            console.error(`Local Hybrid Hit (Confidence: ${confidence.toFixed(2)}). Skipping Context7.`);
          }

          contextExtra += "\n<semantic_memory>\n" + 
            results.map((r: any) => `<context_item category="${r.category}">\n${r.text}\n</context_item>`).join("\n") +
            "\n</semantic_memory>";
          console.error(`Retrieved ${results.length} relevant local memories.`);
        }
      } catch (error) {
        console.error("Error searching semantic memory:", error);
        contextExtra += "\n[Warning]: Could not retrieve memories at this time.";
      }
    }

    // Step 3: Context7 Documentation Integration
    // Only run if Context7 is enabled AND it's NOT a local hybrid hit AND we have tech to search for
    if (dynamicConfig.enableContext7 && !isLocalHit && inferredTechnologies.length > 0) {
      const cacheKey = `c7:${inferredTechnologies.sort().join(",")}:${refinedPrompt}`;
      const cachedDocs = context7Cache.get(cacheKey);

      if (cachedDocs) {
        console.error("Context7: Cache Hit. Using cached documentation.");
        contextExtra += "\n<external_documentation>\n" + cachedDocs + "\n</external_documentation>";
      } else {
        console.error(`Context7: Fetching docs for ${inferredTechnologies.join(", ")}`);
      
      const callMCP = async (method: string, callArgs: any) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout per call

        try {
          const response = await fetch("https://mcp.context7.com/mcp", {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json, text/event-stream",
              ...(dynamicConfig.context7ApiKey ? { "CONTEXT7_API_KEY": dynamicConfig.context7ApiKey } : {})
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: Math.floor(Math.random() * 1000),
              method: "tools/call",
              params: { name: method, arguments: callArgs }
            })
          });

          if (!response.ok) {
            console.error(`Context7 API error: ${response.status} ${response.statusText}`);
            return null;
          }

          const contentType = response.headers.get("content-type");
          if (contentType?.includes("text/event-stream")) {
            const reader = response.body?.getReader();
            if (!reader) return null;
            
            let result = null;
            const decoder = new TextDecoder();
            
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                for (const line of chunk.split("\n")) {
                  if (line.startsWith("data: ")) {
                    try {
                      const rawData = line.substring(6).trim();
                      if (!rawData) continue;
                      const data = JSON.parse(rawData);
                      if (data.result) { result = data; break; }
                    } catch (e) {
                      // Silently skip malformed JSON chunks in SSE
                    }
                  }
                }
                if (result) break;
              }
            } finally {
              reader.releaseLock();
            }
            return result;
          } else {
            return await response.json();
          }
        } catch (err: any) {
          console.error(`Context7 fetch failed for method ${method}:`, err.message);
          return null;
        } finally {
          clearTimeout(timeout);
        }
      };

      // Fetch documentation in parallel for performance
      const docPromises = inferredTechnologies.map(async (lib) => {
        try {
          const resolveData: any = await callMCP("resolve-library-id", { 
            libraryName: lib, 
            query: refinedPrompt 
          });
          
          const resolveText = resolveData?.result?.content?.[0]?.text || "";
          const idMatch = resolveText.match(/library ID: (\/[^\s\n]+)/);
          const libraryId = idMatch ? idMatch[1] : null;

          if (libraryId) {
            const queryData: any = await callMCP("query-docs", { libraryId, query: refinedPrompt });
            const docs = queryData?.result?.content?.[0]?.text;
            if (docs && !docs.includes("MCP error")) {
              return `\n--- [Docs for ${lib}] ---\n${docs}\n`;
            }
          }
        } catch (err: any) {
          console.error(`Error processing docs for ${lib}:`, err.message);
        }
        return "";
      });

      const results = await Promise.allSettled(docPromises);
      let allDocs = results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map(r => r.value)
        .join("");
      
      if (allDocs) {
        context7Cache.set(cacheKey, allDocs);
        contextExtra += "\n<external_documentation>\n" + allDocs + "\n</external_documentation>";
        console.error("Injected external documentation from Context7.");
      }
    }
  }

    // Step 4: Return the SUPER PROMPT to Antigravity
    return {
      content: [
        {
          type: "text",
          text: `${refinedPrompt}\n${contextExtra}`,
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
    
    // Explicitly handle transport errors
    transport.onerror = (error) => {
      console.error("Transport error:", error);
    };
    transport.onclose = () => {
      console.error("Transport closed.");
    };

    await server.connect(transport);
    console.error("OpenCode MCP Server (Stdio) running");

    // Keep the process alive explicitly
    setInterval(() => {}, 1000 * 60 * 60); // 1 hour dummy interval
  }
}

/**
 * Entry point with fatal error handling.
 */
main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
