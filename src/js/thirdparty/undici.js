const EventEmitter = require("node:events");
const StreamModule = require("node:stream");
const { Readable } = StreamModule;
const { Buffer } = require("node:buffer");
const { _ReadableFromWeb: ReadableFromWeb } = require("internal/webstreams_adapters");

const ObjectCreate = Object.create;
const kEmptyObject = ObjectCreate(null);

var fetch = Bun.fetch;
const bindings = $cpp("Undici.cpp", "createUndiciInternalBinding");
const Response = bindings[0];
const Request = bindings[1];
const Headers = bindings[2];
const FormData = bindings[3];
const File = bindings[4];
const URL = bindings[5];
const AbortSignal = bindings[6];
const URLSearchParams = bindings[7];
const WebSocket = bindings[8];
const CloseEvent = bindings[9];
const ErrorEvent = bindings[10];
const MessageEvent = bindings[11];

class FileReader extends EventTarget {
  constructor() {
    super();
  }

  static EMPTY = 0;
  static LOADING = 1;
  static DONE = 2;
}

function notImplemented() {
  throw new Error("This function is not yet implemented in Bun");
}

/**
 * An object representing a URL.
 * @typedef {Object} UrlObject
 * @property {string | number} [port]
 * @property {string} [path]
 * @property {string} [pathname]
 * @property {string} [hostname]
 * @property {string} [origin]
 * @property {string} [protocol]
 * @property {string} [search]
 */

/**
 * @typedef {import('http').IncomingHttpHeaders} IncomingHttpHeaders
 * @typedef {'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'} HttpMethod
 * @typedef {import('stream').Readable} Readable
 * @typedef {import('events').EventEmitter} EventEmitter
 */

class BodyReadable extends ReadableFromWeb {
  #response;
  #bodyUsed;

  constructor(response, options = {}) {
    var { body } = response;
    if (!body) throw new Error("Response body is null");
    super(options, body);

    this.#response = response;
    this.#bodyUsed = response.bodyUsed;
  }

  get bodyUsed() {
    // return this.#response.bodyUsed;
    return this.#bodyUsed;
  }

  #consume() {
    if (this.#bodyUsed) throw new TypeError("unusable");
    this.#bodyUsed = true;
  }

  async arrayBuffer() {
    this.#consume();
    return await this.#response.arrayBuffer();
  }

  async blob() {
    this.#consume();
    return await this.#response.blob();
  }

  async formData() {
    this.#consume();
    return await this.#response.formData();
  }

  async json() {
    this.#consume();
    return await this.#response.json();
  }

  async text() {
    this.#consume();
    return await this.#response.text();
  }
}

// NOT IMPLEMENTED
// *   idempotent?: boolean;
// *   onInfo?: (info: { statusCode: number, headers: Object<string, string | string[]> }) => void;
// *   opaque?: *;
// *   responseHeader: 'raw' | null;
// *   headersTimeout?: number | null;
// *   bodyTimeout?: number | null;
// *   upgrade?: boolean | string | null;
// *   blocking?: boolean;

/**
 * Performs an HTTP request.
 * @param {string | URL | UrlObject} url
 * @param {{
 *   dispatcher: Dispatcher;
 *   method: HttpMethod;
 *   signal?: AbortSignal | EventEmitter | null;
 *   maxRedirections?: number;
 *   body?: string | Buffer | Uint8Array | Readable | null | FormData;
 *   headers?: IncomingHttpHeaders | string[] | null;
 *   query?: Record<string, any>;
 *   reset?: boolean;
 *   throwOnError?: boolean;
 * }} [options]
 * @returns {{
 *   statusCode: number;
 *   headers: IncomingHttpHeaders;
 *   body: ResponseBody;
 *   trailers: Object<string, string>;
 *   opaque: *;
 *   context: Object<string, *>;
 * }}
 */
async function request(
  url,
  options = {
    method: "GET",
    signal: null,
    headers: null,
    query: null,
    // idempotent: false, // GET and HEAD requests are idempotent by default
    // blocking = false,
    // upgrade = false,
    // headersTimeout: 30000,
    // bodyTimeout: 30000,
    reset: false,
    throwOnError: false,
    body: null,
    // dispatcher,
  },
) {
  let {
    method = "GET",
    headers: inputHeaders,
    query,
    signal,
    // idempotent, // GET and HEAD requests are idempotent by default
    // blocking = false,
    // upgrade = false,
    // headersTimeout = 30000,
    // bodyTimeout = 30000,
    reset = false,
    throwOnError = false,
    body: inputBody,
    maxRedirections,
    // dispatcher,
  } = options;

  // TODO: More validations

  if (typeof url === "string") {
    if (query) url = new URL(url);
  } else if (typeof url === "object" && url !== null) {
    if (!(url instanceof URL)) {
      // TODO: Parse undici UrlObject
      throw new Error("not implemented");
    }
  } else throw new TypeError("url must be a string, URL, or UrlObject");

  if (typeof url === "string" && query) url = new URL(url);
  if (typeof url === "object" && url !== null && query) if (query) url.search = new URLSearchParams(query).toString();

  method = method && typeof method === "string" ? method.toUpperCase() : null;
  // idempotent = idempotent === undefined ? method === "GET" || method === "HEAD" : idempotent;

  if (inputBody && (method === "GET" || method === "HEAD")) {
    throw new Error("Body not allowed for GET or HEAD requests");
  }

  if (inputBody && inputBody.read && inputBody instanceof Readable) {
    // TODO: Streaming via ReadableStream?
    let data = "";
    inputBody.setEncoding("utf8");
    for await (const chunk of stream) {
      data += chunk;
    }
    inputBody = new TextEncoder().encode(data);
  }

  if (maxRedirections != null && (!Number.isInteger(maxRedirections) || maxRedirections < 0)) {
    throw new Error("maxRedirections must be a positive number");
  }

  if (signal && !(signal instanceof AbortSignal)) {
    // TODO: Add support for event emitter signal
    throw new Error("signal must be an instance of AbortSignal");
  }

  const followRedirects = maxRedirections != null && maxRedirections > 0;

  /** @type {Response} */
  const resp = await fetch(url, {
    signal,
    mode: "cors",
    method,
    headers: inputHeaders || kEmptyObject,
    body: inputBody,
    redirect: followRedirects ? "follow" : "manual",
    maxRedirects: followRedirects ? maxRedirections : undefined,
    keepalive: !reset,
  });

  const { status: statusCode, headers, trailers } = resp;

  // Throw if received 4xx or 5xx response indicating HTTP error
  if (throwOnError && statusCode >= 400 && statusCode < 600) {
    throw new Error(`Request failed with status code ${statusCode}`);
  }

  const body = resp.body ? new BodyReadable(resp) : null;

  return { statusCode, headers: headers.toJSON(), body, trailers, opaque: kEmptyObject, context: kEmptyObject };
}

function stream() {
  notImplemented();
}
function pipeline() {
  notImplemented();
}
function connect() {
  notImplemented();
}
function upgrade() {
  notImplemented();
}

class MockClient {
  constructor() {}
}
class MockPool {
  constructor() {}
}
class MockAgent {
  constructor() {}
}

function mockErrors() {}

function appendHeader(headers, name, value) {
  if (value === undefined || value === null) return;
  name = String(name);
  if ($isJSArray(value)) {
    for (const v of value) appendHeader(headers, name, v);
    return;
  }
  const existing = headers[name];
  if (existing === undefined) headers[name] = String(value);
  else if ($isJSArray(existing)) existing.push(String(value));
  else headers[name] = [existing, String(value)];
}

function headersFromDispatchOpts(headers) {
  if (headers == null) return kEmptyObject;
  if ($isJSArray(headers)) {
    const out = {};
    if (headers.length > 0 && $isJSArray(headers[0])) {
      for (const [name, value] of headers) appendHeader(out, name, value);
    } else {
      for (let i = 0; i + 1 < headers.length; i += 2) appendHeader(out, headers[i], headers[i + 1]);
    }
    return out;
  }
  return headers;
}

async function bodyFromDispatchOpts(body) {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body;
  if (body instanceof Blob || body instanceof ReadableStream) return body;
  if (body instanceof FormData || body instanceof URLSearchParams) return body;
  if (typeof body[Symbol.asyncIterator] === "function" || typeof body[Symbol.iterator] === "function") {
    const chunks = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
  }
  return body;
}

// One request over fetch(), driving either the legacy undici handler
// callbacks (onHeaders/onData/...) or the v7 controller ones (onResponseStart/...).
function fetchDispatch(origin, opts, handler) {
  const isControllerStyle =
    typeof handler.onRequestStart === "function" || typeof handler.onResponseStart === "function";

  const ac = new AbortController();
  let aborted = false;
  let abortReason;
  let paused = false;
  let resumeResolve = null;
  const resume = () => {
    paused = false;
    if (resumeResolve) {
      const r = resumeResolve;
      resumeResolve = null;
      r();
    }
  };

  const abort = reason => {
    if (aborted) return;
    aborted = true;
    abortReason = reason ?? new RequestAbortedError("Request aborted");
    ac.abort(abortReason);
    // Wake the body loop if it is parked in a pause, so it observes the abort.
    resume();
  };

  const controller = {
    abort,
    pause() {
      paused = true;
    },
    resume,
    get aborted() {
      return aborted;
    },
    get reason() {
      return abortReason;
    },
    get paused() {
      return paused;
    },
  };

  (async () => {
    const url = new URL(opts.path || "/", origin);
    const { query } = opts;
    if (query) url.search = new URLSearchParams(query).toString();
    const method = opts.method ? String(opts.method).toUpperCase() : "GET";
    const body = await bodyFromDispatchOpts(opts.body);

    if (isControllerStyle) handler.onRequestStart?.(controller, kEmptyObject);
    else handler.onConnect?.(abort);
    if (aborted) throw abortReason;

    const maxRedirections = opts.maxRedirections;
    const followRedirects = typeof maxRedirections === "number" && maxRedirections > 0;
    const resp = await fetch(url, {
      method,
      headers: headersFromDispatchOpts(opts.headers),
      body,
      redirect: followRedirects ? "follow" : "manual",
      maxRedirects: followRedirects ? maxRedirections : undefined,
      signal: ac.signal,
      keepalive: !opts.reset,
    });

    // fetch() already decompressed the body, so drop the encoding headers.
    const responseHeaders = resp.headers.toJSON();
    if (method !== "HEAD") {
      delete responseHeaders["content-encoding"];
      delete responseHeaders["content-length"];
    }

    if (isControllerStyle) {
      handler.onResponseStart?.(controller, resp.status, responseHeaders, resp.statusText);
    } else if (typeof handler.onHeaders === "function") {
      const rawHeaders = [];
      for (const name in responseHeaders) {
        const value = responseHeaders[name];
        if ($isJSArray(value)) {
          for (const v of value) rawHeaders.push(Buffer.from(name), Buffer.from(v));
        } else {
          rawHeaders.push(Buffer.from(name), Buffer.from(value));
        }
      }
      if (handler.onHeaders(resp.status, rawHeaders, resume, resp.statusText) === false) paused = true;
    }

    const respBody = resp.body;
    if (respBody) {
      for await (const chunk of respBody) {
        if (aborted) throw abortReason;
        while (paused) {
          await new Promise(r => {
            resumeResolve = r;
          });
        }
        if (aborted) throw abortReason;
        const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        const ret = isControllerStyle ? handler.onResponseData?.(controller, buf) : handler.onData?.(buf);
        if (ret === false) paused = true;
      }
    }

    if (isControllerStyle) handler.onResponseEnd?.(controller, kEmptyObject);
    else handler.onComplete?.([]);
  })().catch(err => {
    if (isControllerStyle && typeof handler.onResponseError === "function") {
      handler.onResponseError(controller, err);
      return;
    }
    if (typeof handler.onError === "function") {
      handler.onError(err);
      return;
    }
    throw err;
  });

  return true;
}

class Dispatcher extends EventEmitter {
  dispatch() {
    throw new Error("not implemented");
  }

  close() {
    throw new Error("not implemented");
  }

  destroy() {
    throw new Error("not implemented");
  }

  request(opts, callback) {
    if (callback === undefined) {
      return new Promise((resolve, reject) => {
        this.request(opts, (err, data) => (err ? reject(err) : resolve(data)));
      });
    }
    if (typeof callback !== "function") throw new InvalidArgumentError("invalid callback");
    if (!opts || typeof opts !== "object") {
      queueMicrotask(() => callback(new InvalidArgumentError("opts must be an object."), null));
      return;
    }

    let body = null;
    let resumeBody = null;
    try {
      this.dispatch(opts, {
        onConnect: () => {},
        onHeaders: (statusCode, rawHeaders, resume, _statusText) => {
          resumeBody = resume;
          body = new Readable({
            read() {
              resumeBody();
            },
          });
          const headers = {};
          for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
            appendHeader(headers, String(rawHeaders[i]).toLowerCase(), String(rawHeaders[i + 1]));
          }
          callback(null, {
            statusCode,
            headers,
            body,
            trailers: kEmptyObject,
            opaque: opts.opaque ?? null,
            context: kEmptyObject,
          });
          return true;
        },
        onData: chunk => body.push(chunk),
        onComplete: () => {
          body.push(null);
        },
        onError: err => {
          if (body) body.destroy(err);
          else callback(err, null);
        },
      });
    } catch (err) {
      // Only reached when dispatch() itself throws without consulting onError.
      if (body) body.destroy(err);
      else callback(err, null);
    }
  }
}

const kDispatch = Symbol("kDispatch");

class DispatcherBase extends Dispatcher {
  #closed = false;
  #destroyed = false;

  get closed() {
    return this.#closed;
  }

  get destroyed() {
    return this.#destroyed;
  }

  close(callback) {
    if (callback === undefined) {
      return new Promise((resolve, reject) => {
        this.close((err, data) => (err ? reject(err) : resolve(data)));
      });
    }
    if (typeof callback !== "function") throw new InvalidArgumentError("invalid callback");
    if (this.#destroyed) {
      queueMicrotask(() => callback(new ClientDestroyedError("The client is destroyed"), null));
      return;
    }
    this.#closed = true;
    queueMicrotask(() => callback(null, null));
  }

  destroy(err, callback) {
    if (typeof err === "function") {
      callback = err;
      err = null;
    }
    if (callback === undefined) {
      return new Promise((resolve, reject) => {
        this.destroy(err, (e, data) => (e ? reject(e) : resolve(data)));
      });
    }
    if (typeof callback !== "function") throw new InvalidArgumentError("invalid callback");
    this.#destroyed = true;
    this.#closed = true;
    queueMicrotask(() => callback(null, null));
  }

  dispatch(opts, handler) {
    if (!handler || typeof handler !== "object") throw new InvalidArgumentError("handler must be an object");
    try {
      if (!opts || typeof opts !== "object") throw new InvalidArgumentError("opts must be an object.");
      if (this.#destroyed) throw new ClientDestroyedError("The client is destroyed");
      if (this.#closed) throw new ClientClosedError("The client is closed");
      return this[kDispatch](opts, handler);
    } catch (err) {
      if (typeof handler.onError === "function") {
        handler.onError(err);
        return false;
      }
      if (typeof handler.onResponseError === "function") {
        handler.onResponseError(null, err);
        return false;
      }
      throw err;
    }
  }

  [kDispatch]() {
    notImplemented();
  }
}

class Agent extends DispatcherBase {
  constructor(_options) {
    super();
  }

  [kDispatch](opts, handler) {
    if (!opts.origin) throw new InvalidArgumentError("opts.origin must be a non-empty string or URL.");
    return fetchDispatch(opts.origin, opts, handler);
  }
}

class Pool extends DispatcherBase {
  #origin;

  constructor(origin, _options) {
    super();
    if (origin == null) throw new InvalidArgumentError("Origin must be a string or URL.");
    this.#origin = origin instanceof URL ? origin : new URL(String(origin));
  }

  [kDispatch](opts, handler) {
    return fetchDispatch(this.#origin, opts, handler);
  }
}

class BalancedPool extends DispatcherBase {
  #upstreams;

  constructor(upstreams = [], _options) {
    super();
    this.#upstreams = ($isJSArray(upstreams) ? upstreams : [upstreams]).map(upstream =>
      upstream instanceof URL ? upstream : new URL(String(upstream)),
    );
  }

  [kDispatch](opts, handler) {
    const upstream = this.#upstreams[0];
    if (!upstream) throw new BalancedPoolMissingUpstreamError("No upstream has been added to the BalancedPool");
    return fetchDispatch(upstream, opts, handler);
  }
}

class Client extends DispatcherBase {
  #origin;

  constructor(origin, _options) {
    super();
    if (origin == null) throw new InvalidArgumentError("Origin must be a string or URL.");
    this.#origin = origin instanceof URL ? origin : new URL(String(origin));
  }

  [kDispatch](opts, handler) {
    return fetchDispatch(this.#origin, opts, handler);
  }
}

class ProxyAgent extends DispatcherBase {
  constructor() {
    super();
  }
}

class EnvHttpProxyAgent extends DispatcherBase {
  constructor() {
    super();
  }
}

class RetryAgent extends DispatcherBase {
  #agent;

  constructor(agent, _options) {
    super();
    if (!agent || typeof agent.dispatch !== "function") {
      throw new InvalidArgumentError("Argument opts.agent must implement Agent");
    }
    this.#agent = agent;
  }

  [kDispatch](opts, handler) {
    return this.#agent.dispatch(opts, handler);
  }
}

class RetryHandler {
  constructor() {}
}

class DecoratorHandler {
  constructor() {}
}

class RedirectHandler {
  constructor() {}
}

function createRedirectInterceptor() {
  return new RedirectHandler();
}

const interceptors = {
  redirect: () => {},
  retry: () => {},
  dump: () => {},
};

// Error classes
class UndiciError extends Error {}
class AbortError extends UndiciError {}
class HTTPParserError extends Error {}
class HeadersTimeoutError extends UndiciError {}
class HeadersOverflowError extends UndiciError {}
class BodyTimeoutError extends UndiciError {}
class RequestContentLengthMismatchError extends UndiciError {}
class ConnectTimeoutError extends UndiciError {}
class ResponseStatusCodeError extends UndiciError {}
class InvalidArgumentError extends UndiciError {
  constructor(message) {
    super(message);
    this.name = "InvalidArgumentError";
    this.code = "UND_ERR_INVALID_ARG";
  }
}
class InvalidReturnValueError extends UndiciError {}
class RequestAbortedError extends AbortError {
  constructor(message) {
    super(message);
    this.name = "AbortError";
    this.code = "UND_ERR_ABORTED";
  }
}
class ClientDestroyedError extends UndiciError {
  constructor(message) {
    super(message);
    this.name = "ClientDestroyedError";
    this.code = "UND_ERR_DESTROYED";
  }
}
class ClientClosedError extends UndiciError {
  constructor(message) {
    super(message);
    this.name = "ClientClosedError";
    this.code = "UND_ERR_CLOSED";
  }
}
class InformationalError extends UndiciError {}
class SocketError extends UndiciError {}
class NotSupportedError extends UndiciError {}
class ResponseContentLengthMismatchError extends UndiciError {}
class BalancedPoolMissingUpstreamError extends UndiciError {
  constructor(message) {
    super(message);
    this.name = "MissingUpstreamError";
    this.code = "UND_ERR_BPL_MISSING_UPSTREAM";
  }
}
class ResponseExceededMaxSizeError extends UndiciError {}
class RequestRetryError extends UndiciError {}
class SecureProxyConnectionError extends UndiciError {}

const errors = {
  AbortError,
  HTTPParserError,
  UndiciError,
  HeadersTimeoutError,
  HeadersOverflowError,
  BodyTimeoutError,
  RequestContentLengthMismatchError,
  ConnectTimeoutError,
  ResponseStatusCodeError,
  InvalidArgumentError,
  InvalidReturnValueError,
  RequestAbortedError,
  ClientDestroyedError,
  ClientClosedError,
  InformationalError,
  SocketError,
  NotSupportedError,
  ResponseContentLengthMismatchError,
  BalancedPoolMissingUpstreamError,
  ResponseExceededMaxSizeError,
  RequestRetryError,
  SecureProxyConnectionError,
};

const util = {
  parseHeaders: () => {
    notImplemented();
  },
  headerNameToString: () => {
    notImplemented();
  },
};

class EventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor() {
    super();
  }
}

// Add missing cookie functions
function deleteCookie() {
  notImplemented();
}

function getCookies() {
  notImplemented();
}

function getSetCookies() {
  notImplemented();
}

function setCookie() {
  notImplemented();
}

// Add missing MIME type functions
function parseMIMEType() {
  notImplemented();
}

function serializeAMimeType() {
  notImplemented();
}

let globalDispatcher;

// Add missing dispatcher functions
function setGlobalDispatcher(dispatcher) {
  if (!dispatcher || typeof dispatcher.dispatch !== "function") {
    throw new InvalidArgumentError("Argument agent must implement Agent");
  }
  globalDispatcher = dispatcher;
}

function getGlobalDispatcher() {
  return (globalDispatcher ??= new Agent());
}

// Add missing origin functions
function setGlobalOrigin() {}

function getGlobalOrigin() {}

// Create empty CacheStorage
const caches = {};

/**
 * Builds a connector function for making network connections
 * @param {Object} [options] Configuration options for the connector
 * @param {boolean} [options.rejectUnauthorized] Whether to reject unauthorized SSL/TLS connections
 * @param {number} [options.connectTimeout] Connection timeout in milliseconds
 * @param {number} [options.maxCachedSessions] Maximum number of cached TLS sessions
 * @param {boolean} [options.allowH2] Whether to allow HTTP/2 connections
 * @returns {function} A connector function
 */
function buildConnector(_options = {}) {
  /**
   * @param {Object} options
   * @param {string} options.hostname
   * @param {number} options.port
   * @param {string} [options.servername]
   * @param {AbortSignal} [options.signal]
   */
  return function connect(_) {
    notImplemented();
  };
}

// Update the exports to match the exact structure
const moduleExports = {
  Agent,
  BalancedPool,
  buildConnector,
  caches,
  Client,
  CloseEvent,
  connect,
  createRedirectInterceptor,
  DecoratorHandler,
  deleteCookie,
  Dispatcher,
  EnvHttpProxyAgent,
  ErrorEvent,
  errors,
  EventSource,
  fetch,
  File,
  FileReader,
  FormData,
  getCookies,
  getGlobalDispatcher,
  getGlobalOrigin,
  getSetCookies,
  Headers,
  interceptors,
  MessageEvent,
  MockAgent,
  MockClient,
  mockErrors,
  MockPool,
  parseMIMEType,
  pipeline,
  Pool,
  ProxyAgent,
  RedirectHandler,
  Request,
  request,
  Response,
  RetryAgent,
  RetryHandler,
  serializeAMimeType,
  setCookie,
  setGlobalDispatcher,
  setGlobalOrigin,
  stream,
  upgrade,
  util,
  WebSocket,
};

moduleExports.default = moduleExports;
export default moduleExports;
