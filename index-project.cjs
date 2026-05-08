const lancedb = require("@lancedb/lancedb");
const ollama = require("ollama");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.MCP_MEMORY_PATH || path.join(process.cwd(), ".data", "vectors");
const TABLE_NAME = "memories";
const EMBEDDING_MODEL = "nomic-embed-text";

async function getEmbedding(text) {
    const response = await ollama.embed({ model: EMBEDDING_MODEL, input: text });
    return response.embeddings[0];
}

async function index() {
    const rootPath = process.cwd();
    const getFiles = (dir, allFiles = []) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (file === "node_modules" || file === ".git" || file === ".data" || file === "dist" || file === "build") continue;
            const name = path.join(dir, file);
            if (fs.statSync(name).isDirectory()) getFiles(name, allFiles);
            else allFiles.push(name);
        }
        return allFiles;
    };

    const files = getFiles(rootPath);
    const structureSummary = `Project Structure at ${rootPath}:\n` + files.map(f => path.relative(rootPath, f)).join("\n");
    
    console.log("Indexing structure...");
    const vector = await getEmbedding(structureSummary);
    const db = await lancedb.connect(DB_PATH);
    
    const data = [{
        vector,
        text: structureSummary,
        category: "architecture",
        timestamp: new Date().toISOString()
    }];

    try {
        const table = await db.openTable(TABLE_NAME);
        await table.add(data);
    } catch {
        await db.createTable(TABLE_NAME, data);
    }
    console.log(`Indexed ${files.length} files successfully.`);
}

index().catch(console.error);
