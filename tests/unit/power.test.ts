/** powers/c64-resurrect — the Power packages copies of repo parts; these tests fail if a copy drifts from its source. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const body = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n/, ""); // strip YAML frontmatter

describe("powers/c64-resurrect", () => {
  const plugin = JSON.parse(read("powers/c64-resurrect/plugin.json"));
  const mcp = JSON.parse(read("powers/c64-resurrect/mcp.json"));
  const workspaceMcp = JSON.parse(read(".kiro/settings/mcp.json"));

  it("has the Agent Plugins required fields and kebab-case name", () => {
    for (const k of ["$schema", "name", "version", "description", "author"]) expect(plugin[k]).toBeTruthy();
    expect(plugin.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(plugin.author.name).toBeTruthy();
    expect(plugin.keywords.length).toBeGreaterThan(3);
  });

  it("starts the same c64 MCP server as the workspace config", () => {
    expect(mcp.mcpServers.c64.command).toBe(workspaceMcp.mcpServers.c64.command);
    expect(mcp.mcpServers.c64.args).toEqual(workspaceMcp.mcpServers.c64.args);
    expect(mcp.mcpServers.c64.env).toEqual(workspaceMcp.mcpServers.c64.env);
  });

  it("ships a byte-equal copy of the petscii-notation skill", () => {
    expect(read("powers/c64-resurrect/skills/petscii-notation/SKILL.md")).toBe(read(".kiro/skills/petscii-notation/SKILL.md"));
  });

  it("ships the commodore-basic-v2 steering body unchanged, as a skill with name + description", () => {
    const skill = read("powers/c64-resurrect/skills/commodore-basic-v2/SKILL.md");
    expect(skill).toMatch(/^---\nname: commodore-basic-v2\ndescription: .+\n---\n/);
    expect(body(skill)).toBe(body(read(".kiro/steering/commodore-basic-v2.md")));
  });
});
