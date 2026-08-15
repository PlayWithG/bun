import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  Agent,
  errors,
  fetch as undiciFetch,
  getGlobalDispatcher,
  request,
  request as request,
  setGlobalDispatcher,
} from "undici";
import { tls as tlsCert } from "harness";

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

describe("undici dispatcher connect.lookup", () => {
  // Reserved TLD (RFC 2606): guaranteed not to resolve, so reaching the local
  // server proves the lookup hook supplied the address.
  const UNRESOLVABLE = "this-host-does-not-exist.invalid";

  function pinningAgent(address = "127.0.0.1") {
    const seen: string[] = [];
    const agent = new Agent({
      connect: {
        lookup: (hostname, _opts, cb) => {
          seen.push(hostname);
          cb(null, address, 4);
        },
      },
    });
    return { agent, seen };
  }

  it("fetch connects to the address returned by the lookup hook", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: req => new Response(req.headers.get("host") ?? "none"),
    });
    const { agent, seen } = pinningAgent();
    const res = await undiciFetch(`http://${UNRESOLVABLE}:${server.port}/`, { dispatcher: agent });
    expect(await res.text()).toBe(`${UNRESOLVABLE}:${server.port}`);
    expect(res.status).toBe(200);
    expect(seen).toEqual([UNRESOLVABLE]);
  });

  it("fetch fails when the lookup hook reports an error, without contacting the server", async () => {
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch: () => {
        hits++;
        return new Response("served");
      },
    });
    const agent = new Agent({
      connect: {
        lookup: (_hostname, _opts, cb) => cb(new Error("blocked by rebinding protection"), "", 0),
      },
    });
    expect(
      await undiciFetch(`http://localhost:${server.port}/`, { dispatcher: agent }).then(
        () => "resolved",
        (err: TypeError) => (err.cause as Error).message,
      ),
    ).toBe("blocked by rebinding protection");
    expect(hits).toBe(0);
  });

  it("lookup hook is skipped for IP literals", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("direct") });
    const { agent, seen } = pinningAgent("192.0.2.1");
    const res = await undiciFetch(`http://127.0.0.1:${server.port}/`, { dispatcher: agent });
    expect(await res.text()).toBe("direct");
    expect(seen).toEqual([]);
  });

  it("lookup hook may return the all:true address-array shape", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("array") });
    const agent = new Agent({
      connect: {
        lookup: (_hostname, _opts, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }] as any, undefined as any),
      },
    });
    const res = await undiciFetch(`http://${UNRESOLVABLE}:${server.port}/`, { dispatcher: agent });
    expect(await res.text()).toBe("array");
  });

  it("the global dispatcher's lookup hook is honored", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("global") });
    const previous = getGlobalDispatcher();
    setGlobalDispatcher(pinningAgent().agent);
    try {
      const res = await undiciFetch(`http://${UNRESOLVABLE}:${server.port}/`);
      expect(await res.text()).toBe("global");
    } finally {
      setGlobalDispatcher(previous);
    }
  });

  it("fetch with a Request input keeps method, headers and body through the pin", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: async req => new Response(`${req.method} ${req.headers.get("x-probe")} ${await req.text()}`),
    });
    const { agent } = pinningAgent();
    const req = new Request(`http://${UNRESOLVABLE}:${server.port}/`, {
      method: "POST",
      headers: { "x-probe": "yes" },
      body: "hello",
    });
    const res = await undiciFetch(req, { dispatcher: agent });
    expect(await res.text()).toBe("POST yes hello");
  });

  it("request() honors the dispatcher's lookup hook", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: req => new Response(req.headers.get("host") ?? "none"),
    });
    const { agent, seen } = pinningAgent();
    const { statusCode, body } = await request(`http://${UNRESOLVABLE}:${server.port}/`, { dispatcher: agent });
    expect(await body!.text()).toBe(`${UNRESOLVABLE}:${server.port}`);
    expect(statusCode).toBe(200);
    expect(seen).toEqual([UNRESOLVABLE]);
  });

  it("https: the pin keeps the original hostname for SNI and certificate verification", async () => {
    await using server = Bun.serve({
      port: 0,
      tls: tlsCert,
      fetch: req => new Response(req.headers.get("host") ?? "none"),
    });
    const { agent, seen } = pinningAgent();
    const verified: string[] = [];
    const res = await undiciFetch(`https://localhost:${server.port}/`, {
      dispatcher: agent,
      // @ts-expect-error Bun-specific fetch option
      tls: {
        ca: tlsCert.cert,
        checkServerIdentity: (hostname: string) => {
          verified.push(hostname);
          return undefined;
        },
      },
    });
    expect(await res.text()).toBe(`localhost:${server.port}`);
    expect(seen).toEqual(["localhost"]);
    expect(verified).toEqual(["localhost"]);
  });

  it("a custom connect function rejects loudly instead of being silently ignored", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("served") });
    const agent = new Agent({ connect: (() => {}) as any });
    expect(
      await undiciFetch(`http://localhost:${server.port}/`, { dispatcher: agent }).then(
        () => "resolved",
        err => (err instanceof errors.NotSupportedError ? "NotSupportedError" : String(err)),
      ),
    ).toBe("NotSupportedError");
  });

  it("an Agent without connect options leaves requests untouched", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("plain") });
    const res = await undiciFetch(`http://127.0.0.1:${server.port}/`, { dispatcher: new Agent() });
    expect(await res.text()).toBe("plain");
  });
});
