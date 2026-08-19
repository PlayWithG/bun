// Standalone Android/Bionic regression reproducer.
// The result is intentionally not referenced from the timer callback: keeping
// it alive there masks the native lifetime bug this test is designed to catch.

const mode = process.argv[2] ?? "repro";
const command = process.env.SHELL || "/bin/sh";
const options = {
  cmd: [command, "-lc", "printf output"],
  stdout: "pipe",
  stderr: "pipe",
  ...(mode === "repro" ? { maxBuffer: 1024 * 1024 } : {}),
};

const result = Bun.spawnSync(options);
console.log(JSON.stringify({
  mode,
  exitCode: result.exitCode,
  stdoutBytes: result.stdout?.length ?? null,
  stderrBytes: result.stderr?.length ?? null,
}));

setTimeout(() => {
  console.log(`TIMER_OK ${mode}`);
  process.exit(0);
}, 100);
