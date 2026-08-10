import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/37310
// Rendering the received value into a matcher failure message used to be
// unbounded: a wide object graph (e.g. a happy-dom tree) expanded to
// gigabytes, and past JSC's maximum string length the assertion error could
// not be created at all, so the failed assertion returned without throwing.

function tree(depth: number, fanout: number): any {
  const node: any = { tag: "div", className: `level-${depth}`, children: [] };
  if (depth > 0) {
    for (let i = 0; i < fanout; i++) node.children.push(tree(depth - 1, fanout));
  }
  return node;
}

test("failure message for a huge object graph is truncated and still throws", () => {
  const root = tree(4, 14); // ~41k nodes, renders several MB untruncated
  let err: Error | undefined;
  try {
    expect(root).toBeNull();
  } catch (e: any) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err!.message.length).toBeLessThan(2 * 1024 * 1024);
  expect(err!.message).toContain("[value truncated]");
});

test("failure message for a small value is not truncated", () => {
  let err: Error | undefined;
  try {
    expect({ a: 1, b: [2, 3] }).toBeNull();
  } catch (e: any) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err!.message).not.toContain("[value truncated]");
  expect(err!.message).toContain("a");
});
