import { expect, test } from "bun:test";
import { modelReferenceKey, normalizeModelReferences } from "./domain";

test("normalizes model visibility references without provider-specific assumptions", () => {
	const references = normalizeModelReferences([
		{ provider: "openai", id: "gpt" },
		{ provider: "openai", id: "gpt" },
		{ provider: "custom/provider", id: "model:latest" },
		{ provider: "", id: "missing" },
		{ provider: "broken", id: "bad\0id" },
		{ provider: 4, id: "wrong" },
	]);

	expect(references).toEqual([
		{ provider: "openai", id: "gpt" },
		{ provider: "custom/provider", id: "model:latest" },
	]);
	const [first, second] = references;
	if (!first || !second) throw new Error("expected normalized references");
	expect(modelReferenceKey(first)).not.toBe(modelReferenceKey(second));
});
