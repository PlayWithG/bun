/**
 * Configure-level regression for Cargo toolchain capability selection.
 *
 * Run with BUN_BUILD_BOOTSTRAP and ANDROID_NDK_ROOT set to verified native
 * build inputs. The fixture uses fake Cargo/Rustup executables because it
 * asserts graph emission, not a Cargo build.
 */

import { strict as assert } from "node:assert";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { configure } from "./configure.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const bootstrap = process.env.BUN_BUILD_BOOTSTRAP;
const androidNdk = process.env.ANDROID_NDK_ROOT;

if (bootstrap === undefined || androidNdk === undefined) {
  throw new Error("BUN_BUILD_BOOTSTRAP and ANDROID_NDK_ROOT are required");
}

const originalPath = process.env.PATH ?? "";
const originalCargoHome = process.env.CARGO_HOME;
const originalRustupHome = process.env.RUSTUP_HOME;
const originalBunInstall = process.env.BUN_INSTALL;
const fixtureRoot = await mkdtemp(join(tmpdir(), "bun-cargo-toolchain-regression-"));

process.chdir(repoRoot);

try {
  await assertCargoRule(fixtureRoot, false, originalPath);
  await assertCargoRule(fixtureRoot, true, originalPath);
  process.stdout.write("cargo toolchain regression: PASS\n");
} finally {
  process.env.PATH = originalPath;
  restoreEnv("CARGO_HOME", originalCargoHome);
  restoreEnv("RUSTUP_HOME", originalRustupHome);
  restoreEnv("BUN_INSTALL", originalBunInstall);
  await rm(fixtureRoot, { recursive: true, force: true });
}

async function assertCargoRule(root: string, withRustup: boolean, pathBeforeFixture: string): Promise<void> {
  const scenario = await mkdtemp(join(root, withRustup ? "cross-" : "native-"));
  const cargoBin = join(scenario, "cargo-bin");
  const cargoHome = join(scenario, "cargo-home");
  const rustupBin = join(cargoHome, "bin");
  await mkdir(cargoBin, { recursive: true });
  await mkdir(rustupBin, { recursive: true });

  const cargo = join(cargoBin, "cargo");
  const rustup = join(rustupBin, "rustup");
  await writeExecutable(cargo);
  if (withRustup) await writeExecutable(rustup);

  // Hide any host Rustup while retaining the native compiler and build tools.
  const pathWithoutRustup = pathBeforeFixture
    .split(delimiter)
    .filter(dir => !isExecutable(join(dir, "rustup")) && !isExecutable(join(dir, "rustup.exe")));
  process.env.PATH = [cargoBin, ...pathWithoutRustup].join(delimiter);
  process.env.CARGO_HOME = cargoHome;
  process.env.RUSTUP_HOME = join(scenario, "rustup-home");
  process.env.BUN_INSTALL = join(scenario, "bun-install");
  process.env.BUN_BUILD_BOOTSTRAP = bootstrap;
  process.env.ANDROID_NDK_ROOT = androidNdk;

  const result = await configure({
    buildType: "Release",
    os: "linux",
    arch: "aarch64",
    abi: "android",
    webkit: "prebuilt",
    buildDir: join(scenario, "build"),
    canary: false,
  });
  const graph = await readFile(result.ninjaFile, "utf8");
  assert.equal(result.cfg.cargo, cargo);
  assert.equal(result.cfg.rustup, withRustup ? rustup : undefined);
  assert.equal(graph.includes("rule dep_cargo"), true);
  assert.equal(graph.includes("rule dep_cargo_cross"), withRustup);
  assert.equal(/rustup(?:\.exe)? target add/.test(graph), withRustup);
  assert.equal(graph.includes("/nonexistent"), false);
}

async function writeExecutable(path: string): Promise<void> {
  await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
