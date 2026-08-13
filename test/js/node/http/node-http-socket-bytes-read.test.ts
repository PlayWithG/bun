import { expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

test("req.socket.bytesRead counts headers and body (#28709)", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<{ atDispatch: number; atEnd: number }>();
  const server = http.createServer((req, res) => {
    // The 'request' event fires after headers are parsed but before any body
    // chunk is delivered, so this samples the header-seeded value alone.
    const atDispatch = req.socket.bytesRead;
    req.on("end", () => {
      resolve({ atDispatch, atEnd: req.socket.bytesRead });
      res.end("ok");
    });
    req.on("error", reject);
    req.resume();
  });
  try {
    await new Promise<void>((res, rej) => {
      server.once("error", rej);
      server.listen(0, res);
    });
    const port = (server.address() as AddressInfo).port;
    const clientReq = http.request({ method: "PUT", port });
    clientReq.on("error", reject);
    clientReq.write("hello");
    clientReq.end();
    const { atDispatch, atEnd } = await promise;
    // Header portion was seeded at request dispatch.
    expect(atDispatch).toBeGreaterThan(0);
    // Body bytes were accumulated on top of the header seed.
    expect(atEnd - atDispatch).toBe("hello".length);
  } finally {
    await new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())));
  }
});
