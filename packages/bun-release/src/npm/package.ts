import type { Platform } from "../platform";
import { createHash } from "node:crypto";

export type NpmReleaseEnvironment = Record<string, string | undefined>;

export type NpmReleaseConfig = {
  owner: string;
  rootPackage: string;
  platforms: Platform[];
  explicitPlatforms: boolean;
  assetName?: string;
  assetFormat: "zip" | "raw";
  assetSha256?: string;
  repository: string;
  bugs: string;
};

export function getNpmReleaseConfig(
  allPlatforms: Platform[],
  env: NpmReleaseEnvironment = process.env,
): NpmReleaseConfig {
  const termux = env.BUN_NPM_MODE === "termux";
  const owner = env.BUN_NPM_OWNER ?? (termux ? "@garvin29" : "@oven");
  const requestedPlatforms = env.BUN_NPM_PLATFORMS?.split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const explicitPlatforms = termux || requestedPlatforms !== undefined;
  const platforms = explicitPlatforms
    ? allPlatforms.filter(platform => (requestedPlatforms ?? ["bun-linux-aarch64-android"]).includes(platform.bin))
    : allPlatforms;

  if (!platforms.length) {
    throw new Error("BUN_NPM_PLATFORMS did not select any supported platforms");
  }

  return {
    owner,
    rootPackage: owner === "@oven" ? "bun" : `${owner}/bun`,
    platforms,
    explicitPlatforms,
    assetName: env.BUN_NPM_ASSET_NAME ?? (termux ? "bun" : undefined),
    assetFormat: env.BUN_NPM_ASSET_FORMAT === "raw" || termux ? "raw" : "zip",
    assetSha256: env.BUN_NPM_ASSET_SHA256,
    repository:
      env.BUN_NPM_REPOSITORY ?? (termux ? "https://github.com/PlayWithG/bun" : "https://github.com/oven-sh/bun"),
    bugs:
      env.BUN_NPM_BUGS ?? (termux ? "https://github.com/PlayWithG/bun/issues" : "https://github.com/oven-sh/issues"),
  };
}

export function platformPackage(owner: string, bin: string): string {
  return `${owner}/${bin}`;
}

export function rootPackageMetadata(
  config: NpmReleaseConfig,
  version: string,
  dryRun: boolean,
): Record<string, unknown> {
  return {
    name: config.rootPackage,
    description: "Bun is a fast all-in-one JavaScript runtime.",
    version,
    scripts: { postinstall: "node install.js" },
    optionalDependencies: Object.fromEntries(
      config.platforms.map(({ bin }) => [
        platformPackage(config.owner, bin),
        dryRun
          ? `file:./${platformPackage(config.owner, bin).replace("@", "").replaceAll("/", "-")}-${version}.tgz`
          : version,
      ]),
    ),
    bin: {
      bun: "bin/bun.exe",
      bunx: "bin/bunx.exe",
    },
    os: [...new Set(config.platforms.map(({ os }) => os))],
    cpu: [...new Set(config.platforms.map(({ arch }) => arch))],
    keywords: ["bun", "bun.js", "node", "node.js", "runtime", "bundler", "transpiler", "typescript"],
    homepage: "https://bun.com",
    bugs: config.bugs,
    license: "MIT",
    repository: config.repository,
  };
}

export function platformPackageMetadata(platform: Platform, name: string, version: string): Record<string, unknown> {
  return {
    name,
    version,
    description: `Native ${platform.os}/${platform.arch} binary for Bun, a fast all-in-one JavaScript runtime.`,
    homepage: "https://bun.com",
    bugs: platform.os === "android" ? "https://github.com/PlayWithG/bun/issues" : "https://github.com/oven-sh/issues",
    license: "MIT",
    repository: platform.os === "android" ? "https://github.com/PlayWithG/bun" : "https://github.com/oven-sh/bun",
    preferUnplugged: true,
    os: [platform.os],
    cpu: [platform.arch],
  };
}

export function verifySha256(data: ArrayBuffer, expected: string): void {
  const actual = createHash("sha256").update(Buffer.from(data)).digest("hex");
  if (actual !== expected.toLowerCase()) {
    throw new Error(`SHA-256 mismatch: expected ${expected}, received ${actual}`);
  }
}
