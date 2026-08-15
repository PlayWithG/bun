import html from "./index-fixture.html";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

const isLinux = process.platform === "linux";

function threadCount(): number {
  const m = readFileSync("/proc/self/status", "utf8").match(/Threads:\s*(\d+)/);
  if (!m) throw new Error("no Threads: line in /proc/self/status");
  return parseInt(m[1], 10);
}

function inotifyFdCount(): number {
  let n = 0;
  for (const name of readdirSync("/proc/self/fd")) {
    let target: string;
    try {
      target = readlinkSync(`/proc/self/fd/${name}`);
    } catch {
      // Closed between readdir and readlink (the readdir handle itself, for one).
      continue;
    }
    if (target.startsWith("anon_inode:inotify")) n++;
  }
  return n;
}

interface Deltas {
  threads: number;
  inotify: number;
}

// Runs `body`, then waits for the watcher threads it tore down to exit. With
// the fix this converges almost immediately; without it the threads are parked
// forever, so a short deadline is enough.
async function measure(body: () => Promise<void>): Promise<Deltas | null> {
  if (!isLinux) {
    await body();
    return null;
  }
  const threadsBefore = threadCount();
  const inotifyBefore = inotifyFdCount();
  await body();
  const deadline = Date.now() + 2000;
  let deltas: Deltas;
  while (true) {
    deltas = { threads: threadCount() - threadsBefore, inotify: inotifyFdCount() - inotifyBefore };
    if ((deltas.threads <= 0 && deltas.inotify <= 0) || Date.now() > deadline) return deltas;
    await Bun.sleep(20);
  }
}

// The issue's scenario: the dev server fails to listen, so its watcher is torn
// down before the watcher thread has anything to watch.
async function listenFailures(): Promise<void> {
  using blocker = Bun.serve({
    port: 0,
    fetch: () => new Response("blocked"),
  });

  for (let i = 0; i < 20; i++) {
    try {
      Bun.serve({
        port: blocker.port,
        reusePort: false,
        development: true,
        routes: { "/": html },
        fetch: () => new Response("unreachable"),
      });
      throw new Error(`iteration ${i}: Bun.serve unexpectedly succeeded on a busy port`);
    } catch (e: any) {
      if (e?.code !== "EADDRINUSE") throw e;
    }
  }
}

async function serveOnce(): Promise<void> {
  const server = Bun.serve({
    port: 0,
    development: true,
    routes: { "/": html },
    fetch: () => new Response("unreachable"),
  });
  const response = await fetch(server.url);
  if (response.status !== 200) throw new Error(`expected 200 from the dev server, got ${response.status}`);
  await response.arrayBuffer();
  await server.stop(true);
}

// The dev server served a request first, so the watcher thread is blocked
// waiting for filesystem events on real watches when it is torn down.
async function servedThenStopped(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await serveOnce();
  }
}

const listenFail = await measure(listenFailures);
// The first bundle starts the bundler thread pool, which stays alive; keep it
// out of the measured window.
await serveOnce();
const served = await measure(servedThenStopped);

if (isLinux) console.log(JSON.stringify({ listenFail, served }));
console.log("PASS");
