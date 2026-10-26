import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const template = path.join(root, "examples", "course-template");
const demoDir = path.join(root, "var", "demo");
const remote = path.join(demoDir, "remote.git");
const course = path.join(demoDir, "course");
const acceptanceWorkspace = path.join(root, "var", "acceptance", "workspace");

function git(args) {
  execFileSync("git", args, { cwd: root, stdio: "inherit" });
}

function configureIdentity(repository) {
  git(["-C", repository, "config", "user.name", "SkillHub Demo"]);
  git(["-C", repository, "config", "user.email", "skillhub-demo@localhost"]);
  git(["-C", repository, "config", "commit.gpgsign", "false"]);
}

mkdirSync(demoDir, { recursive: true });
mkdirSync(acceptanceWorkspace, { recursive: true });

if (!existsSync(remote)) {
  if (existsSync(course)) {
    throw new Error(`${course} 已存在但 ${remote} 不存在，请检查演示目录，脚本不会覆盖它`);
  }
  cpSync(template, course, { recursive: true });
  git(["init", "-b", "main", course]);
  configureIdentity(course);
  git(["-C", course, "add", "."]);
  git(["-C", course, "commit", "-m", "初始团队简报课程"]);
  git(["clone", "--bare", course, remote]);
  git(["-C", course, "remote", "add", "origin", remote]);
  git(["-C", course, "fetch", "origin"]);
  git(["-C", course, "branch", "--set-upstream-to=origin/main", "main"]);
} else if (!existsSync(course)) {
  git(["clone", remote, course]);
  configureIdentity(course);
}

console.log("\nSkillHub 本机演示已就绪");
console.log(`课程 remote: ${remote}`);
console.log(`维护人工作目录: ${course}`);
console.log(`测试工作目录: ${acceptanceWorkspace}`);
console.log("启动开发环境: pnpm dev");
console.log("维护人修改课程后，在工作目录执行 git add . && git commit -m \"改进课程\" && git push");
