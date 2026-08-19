import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("expect dns.lookup to keep the process alive", () => {
  expect([join(import.meta.dir, "dns-fixture.js")]).toRun();
});

test("expect dns.promises.lookup to settle without aborting", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const dns = require("node:dns");
(async () => {
  const result = await dns.promises.lookup("localhost");
  if (!result || typeof result.address !== "string") throw new Error("lookup did not return an address");
  console.log("DNS_LOOKUP_OK");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("DNS_LOOKUP_OK\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("Android c-ares discovers the Termux resolver configuration", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const dns = require("node:dns");
const fs = require("node:fs");

(async () => {
  const skip = () => console.log("DNS_RESOLVER_DISCOVERY_SKIPPED");
  if (process.platform !== "android") return skip();

  const prefix = process.env.PREFIX;
  if (typeof prefix !== "string" || !prefix.startsWith("/")) return skip();

  const configPath = prefix.endsWith("/") ? prefix + "etc/resolv.conf" : prefix + "/etc/resolv.conf";
  let config;
  try {
    config = fs.readFileSync(configPath, "utf8");
  } catch {
    return skip();
  }

  const hasNameserver = config.split(/\\r?\\n/).some(line => {
    const fields = line.split(/[;#]/, 1)[0].trim().split(/\\s+/);
    return fields[0] === "nameserver" && fields[1];
  });
  if (!hasNameserver) return skip();

  const servers = dns.getServers();
  if (servers.length === 0 || (servers.length === 1 && servers[0] === "127.0.0.1")) {
    throw new Error("Android c-ares did not discover configured resolver servers");
  }

  const resolver = new dns.promises.Resolver({ timeout: 1000, tries: 2 });
  const started = performance.now();
  try {
    const addresses = await resolver.resolve4("example.com");
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new Error("resolve4 returned no addresses");
    }
  } catch (error) {
    const code = error && error.code;
    if (!["ENOTFOUND", "ENODATA", "EFORMERR", "ESERVFAIL", "EREFUSED", "ENOTIMP"].includes(code)) {
      throw new Error("resolve4 failed with a timeout or resolver configuration error");
    }
  }

  if (performance.now() - started >= 10000) {
    throw new Error("resolve4 exceeded the bounded resolver deadline");
  }
  console.log("DNS_RESOLVER_DISCOVERY_OK");
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toMatch(/DNS_RESOLVER_DISCOVERY_(OK|SKIPPED)\n/);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
