// https://github.com/oven-sh/bun/issues/21017

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import path from "node:path";

const fixtureFiles = ["dev-server-port-in-use-fixture.ts", "index-fixture.html", "entry-fixture.ts"];

test("tearing down a dev server also tears down its watcher thread", async () => {
  // The fixture modifies one of its own files, so it runs from a scratch copy.
  using dir = tempDir(
    "21017",
    Object.fromEntries(
      await Promise.all(
        fixtureFiles.map(async name => [name, await Bun.file(path.join(import.meta.dir, name)).text()]),
      ),
    ),
  );
  using traceDir = tempDir("21017-trace", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), fixtureFiles[0]],
    env: { ...bunEnv, BUN_WATCHER_TRACE: path.join(String(traceDir), "trace.log") },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr }).toEqual({
    stdout: expect.stringContaining("PASS"),
    stderr: expect.anything(),
  });

  if (isLinux) {
    // Without the fix every dev server leaves one parked watcher thread and one
    // inotify instance behind: 20 for the listen failures and 5 for the served
    // servers. The thread counts get a little slack for unrelated threads.
    const result = JSON.parse(stdout.split("\n").find(line => line.startsWith("{"))!);
    expect(result).toEqual({
      listenFail: { threads: expect.any(Number), inotify: 0 },
      served: { threads: expect.any(Number), inotify: 0 },
      survivorTraced: true,
    });
    expect(result.listenFail.threads).toBeLessThan(10);
    expect(result.served.threads).toBeLessThan(3);
  }

  expect(exitCode).toBe(0);
});
