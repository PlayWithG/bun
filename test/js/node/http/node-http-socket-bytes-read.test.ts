import { expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

test("req.socket.bytesRead counts headers and body (#28709)", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<{
    atDispatch: number;
    atEnd: number;
    atClose: number;
  }>();
  const server = http.createServer((req, res) => {
    // The 'request' event fires after headers are parsed but before any body
    // chunk is delivered, so this samples the header-seeded value alone.
    const atDispatch = req.socket.bytesRead;
    let atEnd = 0;
    req.socket.once("close", () => {
      resolve({ atDispatch, atEnd, atClose: req.socket.bytesRead });
    });
    req.on("end", () => {
      atEnd = req.socket.bytesRead;
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
    // connection: close makes the server close the socket after responding,
    // so the 'close' sample exercises the close-time fold.
    const clientReq = http.request({ method: "PUT", port, headers: { connection: "close" } });
    clientReq.on("error", reject);
    clientReq.write("hello");
    clientReq.end();
    const { atDispatch, atEnd, atClose } = await promise;
    // Header portion was seeded at request dispatch.
    expect(atDispatch).toBeGreaterThan(0);
    // Body bytes were accumulated on top of the header seed.
    expect(atEnd - atDispatch).toBe("hello".length);
    // The count survives the native handle being cleared at close.
    expect(atClose).toBe(atEnd);
  } finally {
    await new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())));
  }
});

test("socket.bytesRead counts CONNECT tunnel bytes (#28709)", async () => {
  const payload = "tunnel-payload";
  const { promise, resolve, reject } = Promise.withResolvers<{ seed: number; after: number }>();
  const server = http.createServer();
  server.on("connect", (req, socket, _head) => {
    const seed = socket.bytesRead;
    socket.once("data", () => {
      resolve({ seed, after: socket.bytesRead });
      socket.end();
    });
    socket.on("error", reject);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  });
  try {
    await new Promise<void>((res, rej) => {
      server.once("error", rej);
      server.listen(0, res);
    });
    const port = (server.address() as AddressInfo).port;
    const client = net.connect(port, "127.0.0.1", () => {
      client.write("CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\n\r\n");
    });
    client.on("error", reject);
    // Wait for the 200 before sending payload so it arrives as tunnel data,
    // not as pipelined head bytes.
    client.once("data", () => {
      client.write(payload);
    });
    const { seed, after } = await promise;
    // CONNECT request line + headers were seeded.
    expect(seed).toBeGreaterThan(0);
    // Tunnel bytes were accumulated on top of the seed.
    expect(after - seed).toBe(payload.length);
    client.destroy();
  } finally {
    await new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())));
  }
});
