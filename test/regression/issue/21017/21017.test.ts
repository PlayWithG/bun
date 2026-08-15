// https://github.com/oven-sh/bun/issues/21017

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import path from "node:path";

test("tearing down a dev server also tears down its watcher thread", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "dev-server-port-in-use-fixture.ts")],
    env: bunEnv,
    cwd: import.meta.dir,
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
    const deltas = JSON.parse(stdout.split("\n").find(line => line.startsWith("{"))!);
    expect(deltas).toEqual({
      listenFail: { threads: expect.any(Number), inotify: 0 },
      served: { threads: expect.any(Number), inotify: 0 },
    });
    expect(deltas.listenFail.threads).toBeLessThan(10);
    expect(deltas.served.threads).toBeLessThan(3);
  }

  expect(exitCode).toBe(0);
});
