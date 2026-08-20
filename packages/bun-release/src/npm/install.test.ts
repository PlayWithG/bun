import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAndroidRuntime } from "./install";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Android npm postinstall runtime", () => {
  test("links Termux libc++ beside the package binary", () => {
    const root = mkdtempSync(join(tmpdir(), "bun-install-test-"));
    const prefix = mkdtempSync(join(tmpdir(), "bun-prefix-test-"));
    temporaryRoots.push(root, prefix);
    const source = join(prefix, "lib", "libc++_shared.so");
    mkdirSync(join(prefix, "lib"), { recursive: true });
    writeFileSync(source, "runtime");

    ensureAndroidRuntime(root, "android", prefix);

    expect(readlinkSync(join(root, "lib", "libc++_shared.so"))).toBe(source);
  });

  test("refreshes a stale libc++ link", () => {
    const root = mkdtempSync(join(tmpdir(), "bun-install-test-"));
    const prefix = mkdtempSync(join(tmpdir(), "bun-prefix-test-"));
    temporaryRoots.push(root, prefix);
    const source = join(prefix, "lib", "libc++_shared.so");
    const stale = join(prefix, "lib", "old-libc++_shared.so");
    mkdirSync(join(prefix, "lib"), { recursive: true });
    writeFileSync(source, "runtime");
    writeFileSync(stale, "old-runtime");

    ensureAndroidRuntime(root, "android", prefix);
    ensureAndroidRuntime(root, "android", prefix);

    expect(readlinkSync(join(root, "lib", "libc++_shared.so"))).toBe(source);
  });

  test("does nothing for non-Android packages", () => {
    const root = mkdtempSync(join(tmpdir(), "bun-install-test-"));
    temporaryRoots.push(root);

    ensureAndroidRuntime(root, "linux", undefined);

    expect(() => readlinkSync(join(root, "lib", "libc++_shared.so"))).toThrow();
  });
});
