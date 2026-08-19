import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { $ } from "bun";

const mode = process.argv[2];

function nextTurn() {
  return new Promise(resolve => setTimeout(resolve, 100));
}

function bufferCase() {
  const utf8 = Buffer.from("caf\u00e9 \ud83c\udf0d", "utf8");
  const hex = Buffer.from("68656c6c6f", "hex");
  const base64 = Buffer.from("aGVsbG8=", "base64");
  const empty = Buffer.from("", "utf8");
  const malformedHex = Buffer.from("zz", "hex");
  const malformedBase64 = Buffer.from("   ", "base64");

  assert.equal(utf8.toString("utf8"), "caf\u00e9 \ud83c\udf0d");
  assert.equal(hex.toString("utf8"), "hello");
  assert.equal(base64.toString("utf8"), "hello");
  assert.equal(empty.length, 0);
  assert.equal(malformedHex.length, 0);
  assert.equal(malformedBase64.length, 0);

  return {
    utf8Hex: utf8.toString("hex"),
    hex: hex.toString("utf8"),
    base64: base64.toString("utf8"),
    empty: empty.length,
    malformedHex: malformedHex.length,
    malformedBase64: malformedBase64.length,
  };
}

function shellCommand() {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "<nul set /p =spawn-out 1>CON & <nul set /p =spawn-err 1>&2"],
    };
  }

  return {
    command: process.env.SHELL || "/bin/sh",
    args: ["-c", "printf spawn-out; printf spawn-err >&2"],
  };
}

function subprocessCase() {
  const shell = shellCommand();
  const result = Bun.spawnSync({
    cmd: [shell.command, ...shell.args],
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: 1024 * 1024,
  });
  const stdout = Buffer.from(result.stdout || []).toString("utf8");
  const stderr = Buffer.from(result.stderr || []).toString("utf8");

  assert.equal(result.exitCode, 0);
  assert.equal(stdout, "spawn-out");
  assert.equal(stderr, "spawn-err");

  return { exitCode: result.exitCode, stdout, stderr };
}

async function shellCase() {
  let output = await $`printf shell-output`.quiet();
  const stdout = output.stdout;
  const bytes = output.bytes();
  const text = output.text();
  const blobText = await output.blob().text();

  assert.equal(Buffer.isBuffer(stdout), true);
  assert.equal(stdout.toString("utf8"), "shell-output");
  assert.equal(Buffer.from(bytes).toString("utf8"), "shell-output");
  assert.equal(text, "shell-output");
  assert.equal(blobText, "shell-output");

  output = null;
  return { stdout: stdout.toString("utf8"), bytes: bytes.length, text, blobText };
}

async function terminalCase() {
  let terminal;
  let proc;
  let received = "";
  let receivedBuffer = false;

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for terminal data")), 5000);
      const finish = (error, value) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };

      terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
        data(_term, chunk) {
          if (!(chunk instanceof Uint8Array)) {
            finish(new Error("Terminal data callback did not receive bytes"));
            return;
          }
          receivedBuffer ||= Buffer.isBuffer(chunk);
          received += chunk.toString("utf8");
          if (received.includes("terminal-output")) finish(null, undefined);
        },
      });
      proc = Bun.spawn({
        cmd: [process.execPath, "-e", "process.stdout.write('terminal-output')"],
        terminal,
      });
    });

    const exitCode = await proc.exited;
    assert.equal(exitCode, 0);
    assert.equal(received.includes("terminal-output"), true);
    assert.equal(receivedBuffer, true);
    return { exitCode, output: received };
  } finally {
    terminal?.close();
  }
}

async function filesystemCase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bun-allocator-buffer-"));
  const filename = path.join(directory, "data.bin");
  const expected = "filesystem-output";
  fs.writeFileSync(filename, expected);

  let syncResult;
  let asyncResult;
  let callbackResult;
  try {
    syncResult = fs.readFileSync(filename);
    asyncResult = await fs.promises.readFile(filename);
    callbackResult = await new Promise((resolve, reject) => {
      fs.readFile(filename, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    assert.equal(syncResult.toString("utf8"), expected);
    assert.equal(asyncResult.toString("utf8"), expected);
    assert.equal(callbackResult.toString("utf8"), expected);

    const result = {
      sync: syncResult.toString("utf8"),
      async: asyncResult.toString("utf8"),
      callback: callbackResult.toString("utf8"),
    };
    syncResult = null;
    asyncResult = null;
    callbackResult = null;
    return result;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function cryptoCase() {
  let result = await new Promise((resolve, reject) => {
    crypto.pbkdf2("password", "salt", 1, 20, "sha256", (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  const hex = result.toString("hex");
  assert.equal(hex, "120fb6cffcf8b32c43e7225256c4f837a86548c9");

  result = null;
  return { hex };
}

const cases = {
  buffer: bufferCase,
  subprocess: subprocessCase,
  shell: shellCase,
  terminal: terminalCase,
  filesystem: filesystemCase,
  crypto: cryptoCase,
};

if (!mode || !Object.hasOwn(cases, mode)) {
  throw new Error(`usage: ${path.basename(import.meta.path)} <${Object.keys(cases).join("|")}>`);
}

const result = await cases[mode]();
console.log(`RESULT ${JSON.stringify(result)}`);
await nextTurn();
console.log(`TIMER_OK ${mode}`);
