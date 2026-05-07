import { spawn } from "child_process";

async function testMCP() {
  const server = spawn("node", ["build/index.js"]);

  const sendRequest = (req: any) => {
    return new Promise((resolve) => {
      server.stdout.once("data", (data) => {
        resolve(JSON.parse(data.toString()));
      });
      server.stdin.write(JSON.stringify(req) + "\n");
    });
  };

  // Test ListTools
  console.log("Testing ListTools...");
  const listToolsReq = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  };
  const listToolsRes = await sendRequest(listToolsReq);
  console.log("ListTools Response:", JSON.stringify(listToolsRes, null, 2));

  // Test CallTool
  console.log("\nTesting CallTool (refine_prompt)...");
  const callToolReq = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "refine_prompt",
      arguments: {
        prompt: "Create an API to manage users",
      },
    },
  };
  const callToolRes = await sendRequest(callToolReq);
  console.log("CallTool Response:", JSON.stringify(callToolRes, null, 2));

  server.kill();
}

testMCP().catch(console.error);
