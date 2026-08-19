import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import { delimiter, dirname, join } from "path";

let cwd: string;

describe("bun", () => {
  test("should error with missing script", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "run", "dev"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Script not found/);
    expect(exitCode).toBe(1);
  });
});

test.if(isWindows)("[windows] A file in drive root runs", () => {
  const path = "C:\\root-file" + Math.random().toString().slice(2) + ".js";
  try {
    writeFileSync(path, "console.log(`PASS`);");
    const { stdout } = bunRun("C:\\root-file.js", {});
    expect(stdout).toBe("PASS");
  } catch {
    rmSync(path);
  }
});

test.skipIf(process.platform !== "android")("stops resolver discovery at inaccessible Android ancestors", () => {
  using dir = tempDir("android-resolver", {
    "package.json": JSON.stringify({
      scripts: {
        "resolver-script": "echo resolver-script",
      },
    }),
    "entry.ts": "export const answer: number = 42;\n",
  });
  const cwd = String(dir);

  const runVersion = spawnSync({
    cmd: [bunExe(), "run", "--version"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(runVersion.exitCode).toBe(0);
  expect(runVersion.stdout.toString()).toContain("Usage: bun run");

  const version = spawnSync({
    cmd: [bunExe(), "--version"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(version.exitCode).toBe(0);
  expect(version.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+(?:[-+].*)?$/);

  const script = spawnSync({
    cmd: [bunExe(), "run", "resolver-script"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(script.exitCode).toBe(0);
  expect(script.stdout.toString()).toContain("resolver-script");

  const build = spawnSync({
    cmd: [bunExe(), "build", "entry.ts", "--outfile", "dist.js"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(build.exitCode).toBe(0);
  expect(readFileSync(join(cwd, "dist.js"), "utf8")).toContain("42");
});

test.skipIf(process.platform !== "android")("uses the configured temp dir for the node shim", () => {
  using dir = tempDir("android-node-shim", {
    "package.json": JSON.stringify({
      scripts: {
        "node-shim":
          'node -e "console.log(JSON.stringify({bun: Boolean(process.versions.bun), node: process.env.NODE, npmNodeExecPath: process.env.npm_node_execpath, path: process.env.PATH}))"',
      },
    }),
  });

  const cwd = String(dir);
  const tempRoot = join(cwd, "bun-tmp");
  mkdirSync(tempRoot);

  const result = spawnSync({
    cmd: [bunExe(), "run", "node-shim"],
    cwd,
    env: {
      ...bunEnv,
      BUN_TMPDIR: tempRoot,
      NODE: undefined,
      npm_node_execpath: undefined,
      PATH: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  const output = JSON.parse(result.stdout.toString().trim().split("\n").at(-1)!);
  const nodePath = output.node as string;
  const nodeDir = dirname(nodePath);
  const bunPath = join(nodeDir, "bun");

  expect(output.bun).toBe(true);
  expect(nodePath.startsWith(`${tempRoot}/bun-node-`)).toBe(true);
  expect((output.npmNodeExecPath as string).startsWith(`${tempRoot}/`)).toBe(true);
  expect((output.path as string).split(delimiter)).toContain(nodeDir);
  expect(existsSync(nodePath)).toBe(true);
  expect(lstatSync(nodePath).isSymbolicLink()).toBe(true);
  expect(realpathSync(nodePath)).toBe(bunExe());
  expect(existsSync(bunPath)).toBe(true);
  expect(lstatSync(bunPath).isSymbolicLink()).toBe(true);
  expect(realpathSync(bunPath)).toBe(bunExe());
});
