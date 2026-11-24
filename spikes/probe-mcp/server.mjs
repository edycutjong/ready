// Probe MCP server "c64": echo tools only. Every real invocation is logged to $RUN_DIR/server-calls.jsonl,
// so "a denied tool does not run" is checked on the server side, not from the model's words.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFileSync, mkdirSync } from "node:fs";
const RUN_DIR = process.env.RUN_DIR || "/tmp/ready-probe";
mkdirSync(RUN_DIR, { recursive: true });
const log = (tool, args) => appendFileSync(`${RUN_DIR}/server-calls.jsonl`, JSON.stringify({ t: new Date().toISOString(), tool, args, runDir: RUN_DIR }) + "\n");
const server = new McpServer({ name: "c64", version: "0.0.1-probe" });
const op = z.object({ op: z.enum(["replace", "renumber"]), lineno: z.number().int(), new_body: z.string().optional(), new_lineno: z.number().int().optional() });
server.registerTool("apply_patch", { description: "Apply 1-4 line ops to the listing (probe: echoes them).", inputSchema: { ops: z.array(op).min(1).max(4), reason: z.string() } },
  async (args) => { log("apply_patch", args); return { content: [{ type: "text", text: `applied ${args.ops.length} op(s): ${JSON.stringify(args.ops)}` }] }; });
server.registerTool("c64_poke", { description: "Write a byte to C64 memory (the probe profile DENIES this tool).", inputSchema: { addr: z.number().int(), value: z.number().int() } },
  async (args) => { log("c64_poke", args); return { content: [{ type: "text", text: `poked ${args.addr}=${args.value}` }] }; });
await server.connect(new StdioServerTransport());
