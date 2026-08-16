import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Readable } from "node:stream";
import { Agent, Client, Pool, RetryAgent, errors, getGlobalDispatcher, request } from "undici";

import { createServer } from "../../../http-test-server";

describe("undici", () => {
  let serverCtl: ReturnType<typeof createServer>;
  let hostUrl: string;
  let port: number;
  let host: string;

  beforeAll(() => {
    serverCtl = createServer();
    port = serverCtl.port;
    host = `${serverCtl.hostname}:${port}`;
    hostUrl = `http://${host}`;
  });

  afterAll(() => {
    serverCtl.stop();
  });

  describe("request", () => {
    it("should make a GET request when passed a URL string", async () => {
      const { body } = await request(`${hostUrl}/get`);
      expect(body).toBeDefined();
      const json = (await body.json()) as { url: string };
      expect(json.url).toBe(`${hostUrl}/get`);
    });

    it("should error when body has already been consumed", async () => {
      const { body } = await request(`${hostUrl}/get`);
      await body.json();
      expect(body.bodyUsed).toBe(true);
      try {
        await body.json();
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("unusable");
      }
    });

    it("should make a POST request when provided a body and POST method", async () => {
      const { body } = await request(`${hostUrl}/post`, {
        method: "POST",
        body: "Hello world",
      });
      expect(body).toBeDefined();
      const json = (await body.json()) as { data: string };
      expect(json.data).toBe("Hello world");
    });

    it("should accept a URL class object", async () => {
      const { body } = await request(new URL(`${hostUrl}/get`));
      expect(body).toBeDefined();
      const json = (await body.json()) as { url: string };
      expect(json.url).toBe(`${hostUrl}/get`);
    });

    // it("should accept an undici UrlObject", async () => {
    //   // @ts-ignore
    //   const { body } = await request({ protocol: "https:", hostname: host, path: "/get" });
    //   expect(body).toBeDefined();
    //   const json = (await body.json()) as { url: string };
    //   expect(json.url).toBe(`${hostUrl}/get`);
    // });

    it("should prevent body from being attached to GET or HEAD requests", async () => {
      try {
        await request(`${hostUrl}/get`, {
          method: "GET",
          body: "Hello world",
        });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Body not allowed for GET or HEAD requests");
      }

      try {
        await request(`${hostUrl}/head`, {
          method: "HEAD",
          body: "Hello world",
        });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Body not allowed for GET or HEAD requests");
      }
    });

    it("should allow a query string to be passed", async () => {
      const { body } = await request(`${hostUrl}/get?foo=bar`);
      expect(body).toBeDefined();
      const json = (await body.json()) as { args: { foo: string } };
      expect(json.args.foo).toBe("bar");

      const { body: body2 } = await request(`${hostUrl}/get`, {
        query: { foo: "bar" },
      });
      expect(body2).toBeDefined();
      const json2 = (await body2.json()) as { args: { foo: string } };
      expect(json2.args.foo).toBe("bar");
    });

    it("should throw on HTTP 4xx or 5xx error when throwOnError is true", async () => {
      try {
        await request(`${hostUrl}/status/404`, { throwOnError: true });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Request failed with status code 404");
      }

      try {
        await request(`${hostUrl}/status/500`, { throwOnError: true });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Request failed with status code 500");
      }
    });

    it("should allow us to abort the request with a signal", async () => {
      const controller = new AbortController();
      try {
        setTimeout(() => controller.abort(), 500);
        const req = await request(`${hostUrl}/delay/5`, {
          signal: controller.signal,
        });
        await req.body.json();
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("The operation was aborted.");
      }
    });

    it("should properly append headers to the request", async () => {
      const { body } = await request(`${hostUrl}/headers`, {
        headers: {
          "x-foo": "bar",
        },
      });
      expect(body).toBeDefined();
      const json = (await body.json()) as { headers: { "x-foo": string } };
      expect(json.headers["x-foo"]).toBe("bar");
    });

    // it("should allow the use of FormData", async () => {
    //   const form = new FormData();
    //   form.append("foo", "bar");
    //   const { body } = await request(`${hostUrl}/post`, {
    //     method: "POST",
    //     body: form,
    //   });

    //   expect(body).toBeDefined();
    //   const json = (await body.json()) as { form: { foo: string } };
    //   expect(json.form.foo).toBe("bar");
    // });
  });

  describe("Dispatcher", () => {
    // Drives dispatch() with the legacy handler interface and collects the response.
    function dispatchLegacy(dispatcher: any, opts: any) {
      return new Promise<{ statusCode: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
        let statusCode = 0;
        const headers: Record<string, string> = {};
        const chunks: Buffer[] = [];
        dispatcher.dispatch(opts, {
          onConnect: () => {},
          onHeaders: (status: number, rawHeaders: Buffer[]) => {
            statusCode = status;
            for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
              headers[String(rawHeaders[i]).toLowerCase()] = String(rawHeaders[i + 1]);
            }
            return true;
          },
          onData: (chunk: Buffer) => {
            chunks.push(chunk);
            return true;
          },
          onComplete: () => resolve({ statusCode, headers, body: Buffer.concat(chunks).toString() }),
          onError: reject,
        });
      });
    }

    it("Pool exposes dispatch(), close() and destroy()", () => {
      const pool = new Pool(hostUrl);
      expect(typeof pool.dispatch).toBe("function");
      expect(typeof pool.close).toBe("function");
      expect(typeof pool.destroy).toBe("function");
      expect(typeof pool.request).toBe("function");
    });

    it("Pool.dispatch performs a request with the legacy handler interface", async () => {
      const pool = new Pool(hostUrl);
      const res = await dispatchLegacy(pool, { path: "/get", method: "GET" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(res.body)).toEqual({ url: `${hostUrl}/get`, method: "GET" });
      await pool.close();
    });

    it("Pool.dispatch performs a request with the controller handler interface", async () => {
      const pool = new Pool(hostUrl);
      const res = await new Promise<{ statusCode: number; headers: any; body: string; ended: boolean }>(
        (resolve, reject) => {
          let statusCode = 0;
          let headers: any;
          let started = false;
          const chunks: Buffer[] = [];
          pool.dispatch(
            { path: "/post", method: "POST", body: "Hello world" },
            {
              onRequestStart: () => {
                started = true;
              },
              onResponseStart: (_controller: any, status: number, responseHeaders: any) => {
                statusCode = status;
                headers = responseHeaders;
              },
              onResponseData: (_controller: any, chunk: Buffer) => {
                chunks.push(chunk);
              },
              onResponseEnd: () => {
                resolve({ statusCode, headers, body: Buffer.concat(chunks).toString(), ended: started });
              },
              onResponseError: (_controller: any, err: Error) => reject(err),
            },
          );
        },
      );
      expect(res.ended).toBe(true);
      expect(res.statusCode).toBe(201);
      expect(res.headers["content-type"]).toBe("application/json");
      expect((JSON.parse(res.body) as { data: string }).data).toBe("Hello world");
      await pool.destroy();
    });

    it("Pool.request body exposes the undici body mixin", async () => {
      const pool = new Pool(hostUrl);
      const { statusCode, body } = await pool.request({ path: "/get", method: "GET" });
      expect(statusCode).toBe(200);
      expect(body.bodyUsed).toBe(false);
      expect(await body.json()).toEqual({ url: `${hostUrl}/get`, method: "GET" });
      expect(body.bodyUsed).toBe(true);
      await expect(body.json()).rejects.toThrow("unusable");
      await pool.close();
    });

    it("Pool.request honors opts.signal", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch() {
          // Never respond; the request can only finish by being aborted.
          return new Promise<Response>(() => {});
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const ac = new AbortController();
      const pending = pool.request({ path: "/", method: "GET", signal: ac.signal });
      ac.abort();
      // The signal's reason (a DOMException named AbortError) propagates, like undici.
      await expect(pending).rejects.toHaveProperty("name", "AbortError");
      await pool.destroy();
    });

    it("a throwing onHeaders routes the error to onError", async () => {
      const pool = new Pool(hostUrl);
      const boom = new Error("bad status");
      const err = await new Promise<any>((resolve, reject) => {
        pool.dispatch(
          { path: "/get", method: "GET" },
          {
            onConnect: () => {},
            onHeaders: () => {
              throw boom;
            },
            onData: () => reject(new Error("should not receive data")),
            onComplete: () => reject(new Error("should not complete")),
            onError: resolve,
          },
        );
      });
      expect(err).toBe(boom);
      await pool.close();
    });

    it("Pool.request resolves with a readable body", async () => {
      const pool = new Pool(hostUrl);
      const { statusCode, headers, body } = await pool.request({ path: "/get", method: "GET" });
      expect(statusCode).toBe(200);
      expect(headers["content-type"]).toBe("application/json");
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(chunk);
      expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({ url: `${hostUrl}/get`, method: "GET" });
      await pool.close();
    });

    it("Client.request sends a request body", async () => {
      const client = new Client(hostUrl);
      const { statusCode, body } = await client.request({ path: "/post", method: "POST", body: "ping" });
      expect(statusCode).toBe(201);
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(chunk);
      expect((JSON.parse(Buffer.concat(chunks).toString()) as { data: string }).data).toBe("ping");
      await client.close();
    });

    it("close() resolves and later dispatches fail with ClientClosedError", async () => {
      const pool = new Pool(hostUrl);
      await pool.close();
      expect(pool.closed).toBe(true);
      await expect(dispatchLegacy(pool, { path: "/get", method: "GET" })).rejects.toHaveProperty(
        "code",
        "UND_ERR_CLOSED",
      );
      await expect(pool.request({ path: "/get", method: "GET" })).rejects.toBeInstanceOf(errors.ClientClosedError);
    });

    it("destroy() resolves and later requests fail with ClientDestroyedError", async () => {
      const pool = new Pool(hostUrl);
      await pool.destroy();
      expect(pool.destroyed).toBe(true);
      await expect(pool.request({ path: "/get", method: "GET" })).rejects.toHaveProperty("code", "UND_ERR_DESTROYED");
    });

    it("dispatch without an error callback throws synchronously", () => {
      const pool = new Pool(hostUrl);
      expect(() =>
        pool.dispatch({ path: "/get", method: "GET" }, {
          onHeaders: () => true,
          onData: () => {},
          onComplete: () => {},
        } as any),
      ).toThrow(errors.InvalidArgumentError);
    });

    it("dispatch keeps '//' paths on the configured origin", async () => {
      const pool = new Pool(hostUrl);
      const res = await dispatchLegacy(pool, { path: "//evil.example/x", method: "GET" });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).url).toStartWith(hostUrl);
      await pool.close();
    });

    it("dispatch rejects paths that do not start with '/'", async () => {
      const pool = new Pool(hostUrl);
      await expect(dispatchLegacy(pool, { path: "http://evil.example/x", method: "GET" })).rejects.toHaveProperty(
        "code",
        "UND_ERR_INVALID_ARG",
      );
      await pool.close();
    });

    it("streams a node Readable request body", async () => {
      const client = new Client(hostUrl);
      const { statusCode, body } = await client.request({
        path: "/post",
        method: "POST",
        body: Readable.from(["pi", "ng"]),
      });
      expect(statusCode).toBe(201);
      expect(((await body.json()) as { data: string }).data).toBe("ping");
      await client.close();
    });

    it("body.destroy() cancels the underlying request", async () => {
      const cancelled = Promise.withResolvers<void>();
      await using server = Bun.serve({
        port: 0,
        fetch() {
          const stream = new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024));
            },
            cancel() {
              cancelled.resolve();
            },
          });
          return new Response(stream, { headers: { "content-type": "application/octet-stream" } });
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const { body } = await pool.request({ path: "/", method: "GET" });
      // Read one chunk, then bail out; breaking destroys the body stream.
      for await (const chunk of body) break;
      await cancelled.promise;
      await pool.destroy();
    });

    it("close() waits for in-flight requests to finish", async () => {
      const gate = Promise.withResolvers<void>();
      await using server = Bun.serve({
        port: 0,
        async fetch() {
          await gate.promise;
          return new Response("done");
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const events: string[] = [];
      const completed = new Promise<void>((resolve, reject) => {
        pool.dispatch(
          { path: "/", method: "GET" },
          {
            onConnect: () => {},
            onHeaders: () => true,
            onData: () => true,
            onComplete: () => {
              events.push("complete");
              resolve();
            },
            onError: reject,
          },
        );
      });
      const closed = pool.close().then(() => {
        events.push("closed");
      });
      gate.resolve();
      await Promise.all([completed, closed]);
      expect(events).toEqual(["complete", "closed"]);
    });

    it("destroy() aborts in-flight requests with ClientDestroyedError", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch() {
          return new Promise<Response>(() => {});
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const errPromise = new Promise<any>((resolve, reject) => {
        pool.dispatch(
          { path: "/", method: "GET" },
          {
            onConnect: () => {},
            onHeaders: () => reject(new Error("should not receive headers")),
            onData: () => {},
            onComplete: () => reject(new Error("should not complete")),
            onError: resolve,
          },
        );
      });
      await pool.destroy();
      const err = await errPromise;
      expect(err.code).toBe("UND_ERR_DESTROYED");
    });

    it("abort() from onData on the final chunk delivers onError, not onComplete", async () => {
      const pool = new Pool(hostUrl);
      let abortFn: ((reason?: Error) => void) | undefined;
      const err = await new Promise<any>((resolve, reject) => {
        pool.dispatch(
          { path: "/get", method: "GET" },
          {
            onConnect: (abort: (reason?: Error) => void) => {
              abortFn = abort;
            },
            onHeaders: () => true,
            onData: () => {
              abortFn!();
              return true;
            },
            onComplete: () => reject(new Error("should not complete")),
            onError: resolve,
          },
        );
      });
      expect(err.code).toBe("UND_ERR_ABORTED");
      await pool.destroy();
    });

    it("RetryAgent.close() closes the wrapped dispatcher", async () => {
      const agent = new Agent();
      const retry = new RetryAgent(agent);
      await retry.close();
      expect(agent.closed).toBe(true);
    });

    it("close(callback) invokes the callback", async () => {
      const pool = new Pool(hostUrl);
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      pool.close((err: Error | null) => (err ? reject(err) : resolve()));
      await promise;
      expect(pool.closed).toBe(true);
    });

    it("abort() while the body is paused delivers onError instead of hanging", async () => {
      let pulls = 0;
      await using server = Bun.serve({
        port: 0,
        fetch() {
          const stream = new ReadableStream({
            pull(controller) {
              pulls++;
              controller.enqueue(new Uint8Array(1024));
            },
          });
          return new Response(stream, { headers: { "content-type": "application/octet-stream" } });
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      let abortFn: ((reason?: Error) => void) | undefined;
      const err = await new Promise<any>((resolve, reject) => {
        pool.dispatch(
          { path: "/", method: "GET" },
          {
            onConnect: (abort: (reason?: Error) => void) => {
              abortFn = abort;
            },
            onHeaders: () => true,
            // Pause after the first chunk so the body loop parks.
            onData: () => false,
            onComplete: () => reject(new Error("should not complete")),
            onError: resolve,
          },
        );
        (async () => {
          // Wait until more chunks are in flight, so the paused loop is parked
          // holding an undelivered chunk, then abort.
          const deadline = Date.now() + 5_000;
          while (pulls < 3 && Date.now() < deadline) await Bun.sleep(5);
          abortFn!();
        })();
      });
      expect(err.code).toBe("UND_ERR_ABORTED");
      await pool.destroy();
    });

    it("aborting from onConnect rejects with UND_ERR_ABORTED", async () => {
      const pool = new Pool(hostUrl);
      const err = await new Promise<any>((resolve, reject) => {
        pool.dispatch(
          { path: "/get", method: "GET" },
          {
            onConnect: (abort: (reason?: Error) => void) => abort(),
            onHeaders: () => reject(new Error("should not receive headers")),
            onData: () => {},
            onComplete: () => reject(new Error("should not complete")),
            onError: resolve,
          },
        );
      });
      expect(err.code).toBe("UND_ERR_ABORTED");
      await pool.close();
    });

    it("Agent dispatches using opts.origin", async () => {
      const agent = new Agent();
      const res = await dispatchLegacy(agent, { origin: hostUrl, path: "/get", method: "GET" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ url: `${hostUrl}/get`, method: "GET" });
      await agent.close();
    });

    it("getGlobalDispatcher returns a functional dispatcher", async () => {
      const dispatcher = getGlobalDispatcher();
      expect(typeof dispatcher.dispatch).toBe("function");
      expect(typeof dispatcher.close).toBe("function");
      expect(typeof dispatcher.destroy).toBe("function");
      const res = await dispatchLegacy(dispatcher, { origin: hostUrl, path: "/get", method: "GET" });
      expect(res.statusCode).toBe(200);
    });

    it("new Pool() without an origin throws InvalidArgumentError", () => {
      expect(() => new (Pool as any)()).toThrow(errors.InvalidArgumentError);
    });
  });
});

describe("undici.request maxRedirections", () => {
  it("does not follow more redirects than maxRedirections allows", async () => {
    const hits: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        hits.push(pathname);
        if (pathname.startsWith("/redirect/")) {
          const hop = Number(pathname.slice("/redirect/".length));
          if (hop >= 5) {
            return Response.json({ done: true, hop });
          }
          return new Response(null, {
            status: 302,
            headers: { location: `/redirect/${hop + 1}` },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const origin = `http://localhost:${server.port}`;

      // The caller's cap must be enforced: with maxRedirections: 1 only one
      // redirect may be followed, so the client stops at /redirect/1 instead
      // of chasing the chain to the end.
      hits.length = 0;
      await expect(request(`${origin}/redirect/0`, { maxRedirections: 1 })).rejects.toThrow(
        "redirected too many times",
      );
      expect(hits).toEqual(["/redirect/0", "/redirect/1"]);

      // A cap large enough for the whole chain still reaches the final response.
      hits.length = 0;
      const followed = await request(`${origin}/redirect/0`, { maxRedirections: 10 });
      expect(hits).toEqual(["/redirect/0", "/redirect/1", "/redirect/2", "/redirect/3", "/redirect/4", "/redirect/5"]);
      expect(followed.statusCode).toBe(200);
      expect(((await followed.body!.json()) as { done: boolean; hop: number }).hop).toBe(5);

      // Invalid caps are rejected up front instead of being silently ignored.
      await expect(request(`${origin}/redirect/0`, { maxRedirections: -1 })).rejects.toThrow(
        "maxRedirections must be a positive number",
      );
    } finally {
      server.stop(true);
    }
  });
});
