const lancedb = require("@lancedb/lancedb");
const path = require("path");

const DB_PATH = process.env.MCP_MEMORY_PATH || path.join(process.cwd(), ".data", "vectors");
const TABLE_NAME = "memories";

async function showStats() {
    try {
        const db = await lancedb.connect(DB_PATH);
        const table = await db.openTable(TABLE_NAME);
        const count = await table.countRows();
        const samples = await table.query().limit(5).toArray();
        
        console.log("\n==========================================");
        console.log("   🚀 OPENCODE MCP SEMANTIC DASHBOARD   ");
        console.log("==========================================\n");
        console.log(`Total Stored Memories: ${count}`);
        
        const categories = {};
        const all = await table.query().toArray();
        all.forEach(r => {
            categories[r.category] = (categories[r.category] || 0) + 1;
        });

        console.log("\nCategories Distribution:");
        Object.entries(categories).forEach(([cat, val]) => {
            console.log(`- ${cat.padEnd(15)}: ${val} items`);
        });

        console.log("\nRecent Snippets:");
        samples.forEach(s => {
            console.log(`> [${s.category}] ${s.text.substring(0, 80)}...`);
        });
        console.log("\n==========================================\n");

    } catch (e) {
        console.error("Error loading dashboard stats. Ensure the database exists and has data.");
    }
}

showStats();
