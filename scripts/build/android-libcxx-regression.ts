/**
 * Configure-level regression for Android libc++ capability selection.
 *
 * This exercises resolveConfig() and computeFlags() with small NDK capability
 * fixtures. It deliberately does not link, run Bun, or invoke Ninja.
 */

import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { androidSharedRuntimeRpath, resolveConfig, type Config, type Toolchain } from "./config.ts";
import { BuildError } from "./error.ts";
import { computeFlags } from "./flags.ts";
import { Ninja } from "./ninja.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const originalCwd = process.cwd();
const originalPrefix = process.env.PREFIX;
const originalQuietLogs = process.env.BUN_DEBUG_QUIET_LOGS;
const fixtureRoot = await mkdtemp(join(tmpdir(), "bun-android-libcxx-regression-"));

process.chdir(repoRoot);
process.env.BUN_DEBUG_QUIET_LOGS = "1";

try {
  const shared = await resolveScenario(fixtureRoot, "aarch64", false);
  assert.equal(typeof shared.cfg.host.android, "boolean");
  assert.equal(shared.cfg.tinycc, true);
  assert.equal(shared.cfg.androidLibcxxStatic, false);
  assert.equal(shared.cfg.androidLibcxxShared, true);
  assert.equal(shared.cfg.androidLibcxxDir, shared.libcxxDir);
  assert.equal(shared.cfg.androidLibcxxRpath, shared.cfg.host.android ? join(shared.prefix, "lib") : "$ORIGIN/../lib");
  assert.equal(androidSharedRuntimeRpath(false, shared.prefix), "$ORIGIN/../lib");

  const crossCfg = {
    ...shared.cfg,
    host: { ...shared.cfg.host, android: false },
    androidLibcxxRpath: "$ORIGIN/../lib",
  };
  const crossFlags = computeFlags(crossCfg).ldflags;
  assert(!crossFlags.includes("-fno-termux-rpath"));
  assert(crossFlags.includes("'-Wl,-rpath,$ORIGIN/../lib'"));
  const ninja = new Ninja({ buildDir: shared.cfg.buildDir });
  ninja.rule("link", { command: "link $ldflags" });
  ninja.build({
    outputs: [join(shared.cfg.buildDir, "origin-check")],
    rule: "link",
    inputs: [],
    vars: { ldflags: crossFlags.join(" ") },
  });
  assert(ninja.toString().includes("'-Wl,-rpath,$$ORIGIN/../lib'"));

  const sharedFlags = computeFlags(shared.cfg).ldflags;
  assert.equal(shared.cfg.host.android, true);
  assert(sharedFlags.includes("-fno-termux-rpath"));
  assert(!sharedFlags.includes("-static-libstdc++"));
  assert(sharedFlags.includes(`-L${shared.libcxxDir}`));
  const expectedSharedRpath = shared.cfg.host.android
    ? `-Wl,-rpath,${join(shared.prefix, "lib")}`
    : "'-Wl,-rpath,$ORIGIN/../lib'";
  assert(sharedFlags.includes(expectedSharedRpath));
  assert(sharedFlags.includes(`-L${shared.cfg.androidNdkRuntimeDir}/aarch64`));
  const androidPolicyFlags = sharedFlags.filter(
    flag =>
      flag.startsWith("--target=") ||
      flag.startsWith("--sysroot=") ||
      flag.startsWith("--rtlib=") ||
      flag.startsWith("--unwindlib=") ||
      flag === "-stdlib=libc++" ||
      flag.startsWith("-L") ||
      flag === "-static-libstdc++" ||
      flag.startsWith("-Wl,-rpath,"),
  );
  assert(!androidPolicyFlags.some(flag => flag.includes(homedir())));
  assertNoAbsoluteBuildPathInRuntimeRpath(sharedFlags, shared.cfg);
  assertNoAbsoluteBuildPathInRuntimeRpath(crossFlags, shared.cfg);

  const staticNdk = await resolveScenario(fixtureRoot, "x86_64", true);
  assert.equal(staticNdk.cfg.androidLibcxxStatic, true);
  assert.equal(staticNdk.cfg.androidLibcxxShared, true);

  const staticFlags = computeFlags(staticNdk.cfg).ldflags;
  assert(staticFlags.includes("-static-libstdc++"));
  assert(staticFlags.includes(`-L${staticNdk.libcxxDir}`));
  assert(!staticFlags.some(flag => flag.startsWith("-Wl,-rpath,")));
  assertNoAbsoluteBuildPathInRuntimeRpath(staticFlags, staticNdk.cfg);
  assert(staticFlags.includes(`-L${staticNdk.cfg.androidNdkRuntimeDir}/x86_64`));

  await assertMissingRuntime(fixtureRoot);
  const flagsSource = await readFile(resolve(repoRoot, "scripts/build/flags.ts"), "utf8");
  assert(!flagsSource.includes(homedir()));
  process.stdout.write("android libc++ regression: PASS\n");
} finally {
  process.chdir(originalCwd);
  restoreEnv("PREFIX", originalPrefix);
  restoreEnv("BUN_DEBUG_QUIET_LOGS", originalQuietLogs);
  await rm(fixtureRoot, { recursive: true, force: true });
}

async function resolveScenario(root: string, arch: "aarch64" | "x86_64", withStatic: boolean): Promise<Scenario> {
  const scenarioRoot = join(root, `${arch}-${withStatic ? "static" : "shared"}`);
  const resourceDir = join(scenarioRoot, "clang-resource");
  const androidNdk = join(scenarioRoot, "android-ndk");
  const prefix = join(scenarioRoot, "prefix");
  const libcxxArch = arch === "aarch64" ? "aarch64-linux-android" : "x86_64-linux-android";
  const targetTriple = arch === "aarch64" ? "aarch64-unknown-linux-android28" : "x86_64-unknown-linux-android28";
  const prebuilt = join(androidNdk, "toolchains", "llvm", "prebuilt", "linux-x86_64");
  const sysroot = join(prebuilt, "sysroot");
  const libcxxDir = join(sysroot, "usr", "lib", libcxxArch);

  await mkdir(join(prebuilt, "lib", "clang", "21", "lib", "linux"), { recursive: true });
  await mkdir(join(resourceDir, "lib", targetTriple), { recursive: true });
  await mkdir(join(resourceDir, "lib", "linux", arch), { recursive: true });
  await writeFile(join(prebuilt, "lib", "clang", "21", "marker"), "fixture\n");
  await writeFile(join(resourceDir, "lib", targetTriple, "libclang_rt.builtins.a"), "fixture\n");
  await writeFile(join(resourceDir, "lib", targetTriple, "libunwind.a"), "fixture\n");
  await writeFile(join(resourceDir, "lib", "linux", `libclang_rt.builtins-${arch}-android.a`), "fixture\n");
  await writeFile(join(resourceDir, "lib", "linux", arch, "libunwind.a"), "fixture\n");
  await mkdir(libcxxDir, { recursive: true });
  await writeFile(join(libcxxDir, "libc++_shared.so"), "fixture\n");
  if (withStatic) await writeFile(join(libcxxDir, "libc++_static.a"), "fixture\n");
  await mkdir(join(prefix, "lib"), { recursive: true });
  await writeFile(join(prefix, "lib", "libc++_shared.so"), "fixture\n");

  const compiler = join(scenarioRoot, "fake-clang");
  await mkdir(scenarioRoot, { recursive: true });
  await writeFile(
    compiler,
    `#!/bin/sh\n[ "$1" = "-print-resource-dir" ] || exit 2\nprintf '%s' ${shellQuote(resourceDir)}\n`,
    { mode: 0o755 },
  );

  process.env.PREFIX = prefix;
  const cfg = resolveConfig(
    {
      buildType: "Release",
      os: "linux",
      arch: arch === "aarch64" ? "aarch64" : "x64",
      abi: "android",
      androidNdk,
      buildDir: join(scenarioRoot, "build"),
      cacheDir: join(scenarioRoot, "cache"),
      canary: false,
    },
    toolchain(compiler, scenarioRoot),
  );

  return { cfg, androidNdk, libcxxDir, prefix };
}

async function assertMissingRuntime(root: string): Promise<void> {
  const scenario = await resolveScenario(root, "aarch64", false);
  await rm(scenario.libcxxDir, { recursive: true, force: true });
  const scenarioRoot = join(root, "missing");

  assert.throws(
    () =>
      resolveConfig(
        {
          buildType: "Release",
          os: "linux",
          arch: "aarch64",
          abi: "android",
          androidNdk: scenario.androidNdk,
          buildDir: join(scenarioRoot, "build"),
          cacheDir: join(scenarioRoot, "cache"),
          canary: false,
        },
        toolchain(join(root, "aarch64-shared", "fake-clang"), scenarioRoot),
      ),
    error =>
      error instanceof BuildError &&
      error.format().includes("libc++_static.a") &&
      error.format().includes("libc++_shared.so"),
  );
}

function assertNoAbsoluteBuildPathInRuntimeRpath(flags: string[], cfg: Config): void {
  const runtimeRpaths = flags.filter(flag => flag.includes("-Wl,-rpath,"));
  assert(runtimeRpaths.every(flag => !flag.includes(cfg.sysroot!)));
  assert(runtimeRpaths.every(flag => !flag.includes(cfg.buildDir)));
}

function toolchain(compiler: string, root: string): Toolchain {
  return {
    cc: compiler,
    cxx: compiler,
    clangVersion: "21.1.8",
    ar: compiler,
    ranlib: compiler,
    ld: compiler,
    strip: compiler,
    dsymutil: undefined,
    zig: compiler,
    bun: compiler,
    jsRuntime: process.execPath,
    esbuild: compiler,
    ccache: undefined,
    cmake: compiler,
    cargo: undefined,
    rustup: undefined,
    cargoHome: join(root, "cargo-home"),
    rustupHome: join(root, "rustup-home"),
    msvcLinker: undefined,
    rc: undefined,
    mt: undefined,
    nasm: undefined,
  };
}

interface Scenario {
  cfg: Config;
  androidNdk: string;
  libcxxDir: string;
  prefix: string;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
