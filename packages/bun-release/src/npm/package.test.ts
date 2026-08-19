import { describe, expect, test } from "bun:test";
import { platforms } from "../platform";
import { getNpmReleaseConfig, platformPackageMetadata, rootPackageMetadata, verifySha256 } from "./package";

describe("scoped Termux npm release", () => {
  const config = getNpmReleaseConfig(platforms, { BUN_NPM_MODE: "termux" });

  test("selects Android ARM64 and scoped package names", () => {
    expect(config.platforms).toHaveLength(1);
    expect(config.platforms[0]).toMatchObject({
      os: "android",
      arch: "arm64",
      bin: "bun-linux-aarch64-android",
    });
    expect(config.rootPackage).toBe("@garvin29/bun");
    expect(config.assetName).toBe("bun");
    expect(config.assetFormat).toBe("raw");
  });

  test("writes platform metadata for npm optional dependency resolution", () => {
    const platform = config.platforms[0];
    const root = rootPackageMetadata(config, "1.3.14", false);
    const binary = platformPackageMetadata(platform, "@garvin29/bun-linux-aarch64-android", "1.3.14");

    expect(root).toMatchObject({
      name: "@garvin29/bun",
      optionalDependencies: { "@garvin29/bun-linux-aarch64-android": "1.3.14" },
      os: ["android"],
      cpu: ["arm64"],
      license: "MIT",
      repository: "https://github.com/PlayWithG/bun",
      bugs: "https://github.com/PlayWithG/bun/issues",
      bin: { bun: "bin/bun.exe", bunx: "bin/bunx.exe" },
    });
    expect(binary).toMatchObject({
      name: "@garvin29/bun-linux-aarch64-android",
      os: ["android"],
      cpu: ["arm64"],
      license: "MIT",
      repository: "https://github.com/PlayWithG/bun",
      bugs: "https://github.com/PlayWithG/bun/issues",
    });
    expect(binary.description).toBe("Native android/arm64 binary for Bun, a fast all-in-one JavaScript runtime.");
  });

  test("rejects a corrupted raw Android asset", () => {
    expect(() => verifySha256(new TextEncoder().encode("bun").buffer, "00".repeat(32))).toThrow("SHA-256 mismatch");
  });

  test("keeps the official package defaults", () => {
    const official = getNpmReleaseConfig(platforms, {});
    expect(official.rootPackage).toBe("bun");
    expect(official.owner).toBe("@oven");
    expect(official.platforms).toBe(platforms);
    expect(rootPackageMetadata(official, "1.3.14", true).optionalDependencies).toMatchObject({
      "@oven/bun-linux-aarch64": "file:./oven-bun-linux-aarch64-1.3.14.tgz",
    });
  });
});
