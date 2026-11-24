/**
 * The `c64` MCP server (stdio) — wiring only (.kiro/specs/c64-mcp-server/design.md "server.ts wiring", R1). All tool
 * logic lives in tools.ts. claude-direct (P1b): the Kiro credit line for this spec reached its cap after task 5.
 *
 * The low-level `Server` is used on purpose: McpServer validates arguments itself and answers failures, so the
 * server could neither count malformed calls (R11.4) nor log them (R11.1). STDOUT belongs to the protocol, so every
 * console method is redirected to STDERR before anything else runs (R1.3).
 */
console.log = console.info = console.debug = (...a: unknown[]) => console.error(...a);

const die = (why: unknown): never => {
  process.stderr.write(`c64 server: ${why instanceof Error ? why.message : String(why)}\n`);
  process.exit(1);
};

const { resolveRunDir } = await import("./rundir.ts");
const runDir = resolveRunDir(process.env.RUN_DIR);
if (!runDir) die("RUN_DIR must name an existing directory (the runner sets it per run)");

const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
const { bootNodeCore } = await import("../../src/emu/node.ts");
const { createTools } = await import("./tools.ts");

const core = await bootNodeCore().catch(die);
const tools = await createTools(core, runDir!).catch(die);
const server = new Server({ name: "c64", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: tools.list() as never }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const r = await tools.call(req.params.name, req.params.arguments);
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError, ...(r.data ? { structuredContent: r.data } : {}) };
});
await server.connect(new StdioServerTransport());
process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

export {};
