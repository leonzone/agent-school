import { DatabaseSync } from "node:sqlite";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "../config.js";
import { InstallationService } from "../installations.js";
import { SkillHubRepository } from "./catalog.js";
import { SkillInstaller } from "./installations.js";
import { createSkillHubMcpServer } from "./mcp-server.js";
import { SkillHubInstallService } from "./service.js";

const db = new DatabaseSync(":memory:");
const repository = new SkillHubRepository(config.skillHubRoot);
const installer = new SkillInstaller(config.skillsRoot, new InstallationService(db));
const server = createSkillHubMcpServer(repository, installer, new SkillHubInstallService(repository, installer));
await server.connect(new StdioServerTransport());
process.once("exit", () => db.close());
