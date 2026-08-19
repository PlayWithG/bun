/**
 * Configure-level regression for the bindgenv2 list-outputs protocol.
 *
 * This exercises the pure parser without spawning Bun or invoking Ninja.
 */

import { strict as assert } from "node:assert";
import { parseBindgenV2ListOutputs } from "./codegen.ts";

const begin = "BUN_BINDGENV2_LIST_OUTPUTS_BEGIN";
const end = "BUN_BINDGENV2_LIST_OUTPUTS_END";
const outputs = [
  "/build/codegen/bindgen_generated.zig",
  "/build/codegen/bindgen_generated/fake_timers_config.zig",
  "/build/codegen/GeneratedSocketConfig.cpp",
];

assert.deepEqual(parseBindgenV2ListOutputs(frame(outputs.join(";"))), outputs);
assert.deepEqual(parseBindgenV2ListOutputs(`[sys] write diagnostics${frame(outputs.join(";"))}`), outputs);
assert.deepEqual(parseBindgenV2ListOutputs(`${frame(outputs.join(";"))}[filesink] write diagnostics\n`), outputs);

assert.throws(() => parseBindgenV2ListOutputs(outputs.join(";")), /missing/);
assert.throws(
  () => parseBindgenV2ListOutputs(`${begin}\n${outputs.join(";")}\n${end}\n${begin}\n${outputs.join(";")}\n${end}`),
  /duplicate/,
);
assert.throws(() => parseBindgenV2ListOutputs(`${begin}\n${outputs.join(";")}\n[diagnostic]\n${end}\n`), /malformed/);
assert.throws(() => parseBindgenV2ListOutputs(frame("/build/codegen/bindgen_generated.txt")), /unexpected output type/);

process.stdout.write("bindgenv2 list-output regression: PASS\n");

function frame(payload: string): string {
  return `\n${begin}\n${payload}\n${end}\n`;
}
