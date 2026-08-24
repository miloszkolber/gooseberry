import assert from "node:assert/strict";
import test from "node:test";
import mewaQuestion from "../dist/pi/extensions/mewa-question.js";

test("question returns the user's selected answer", async () => {
  let tool;
  mewaQuestion({ registerTool(candidate) { tool = candidate; } });
  const result = await tool.execute(
    "call-1",
    { prompt: "Choose", options: ["Alpha", "Beta"] },
    undefined,
    undefined,
    {
      hasUI: true,
      ui: { select: async () => "Beta" },
    },
  );
  assert.deepEqual(result.content, [{ type: "text", text: "Beta" }]);
  assert.deepEqual(result.details, { answer: "Beta" });
});

test("question fails closed when interactive input is unavailable", async () => {
  let tool;
  mewaQuestion({ registerTool(candidate) { tool = candidate; } });
  await assert.rejects(
    tool.execute("call-2", { prompt: "Choose" }, undefined, undefined, { hasUI: false }),
    /unavailable/,
  );
});
