import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, KNOWN_MODELS } from "./anthropic.js";

test("normalize splits system turns and keeps user/assistant order", () => {
  const { system, messages } = normalize(
    [
      { role: "system", content: "base rules" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "next" },
    ],
    "override"
  );
  assert.equal(system, "override\n\nbase rules");
  assert.deepEqual(messages, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "next" },
  ]);
});

test("normalize drops malformed entries", () => {
  const { messages } = normalize([{ role: "user" }, { role: "tool", content: "x" }, null], undefined);
  assert.equal(messages.length, 0);
});

test("known models are date-suffix free", () => {
  for (const m of KNOWN_MODELS) assert.ok(!/\d{8}$/.test(m), `${m} must not have a date suffix`);
});
