import { expect, test } from "bun:test";
import {
	ACCEPTED_IMAGE_TYPES,
	IMAGE_MAX_BASE64_BYTES,
	modelReferenceKey,
	normalizeModelReferences,
	REQUEST_IMAGE_BASE64_BUDGET,
	validateRequestImages,
} from "../../contracts/src/domain";

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

test("validates canonical image request blocks and their encoded budgets", () => {
	expect(() =>
		validateRequestImages([{ type: "image", mimeType: "image/png", data: "AA==" }]),
	).not.toThrow();
	expect(() =>
		validateRequestImages([{ type: "image", mimeType: "image/png", data: "AB==" }]),
	).toThrow("canonical base64");
	expect(() =>
		validateRequestImages([{ type: "image", mimeType: "text/plain", data: "AA==" }]),
	).toThrow("Unsupported image media type");
	expect(() =>
		validateRequestImages([
			{
				type: "image",
				mimeType: ACCEPTED_IMAGE_TYPES[0],
				data: "A".repeat(IMAGE_MAX_BASE64_BYTES + 4),
			},
		]),
	).toThrow("4.5 MiB");
	const atLimit = "A".repeat(IMAGE_MAX_BASE64_BYTES);
	expect(() =>
		validateRequestImages(
			Array.from(
				{ length: Math.floor(REQUEST_IMAGE_BASE64_BUDGET / IMAGE_MAX_BASE64_BYTES) + 1 },
				() => ({
					type: "image" as const,
					mimeType: "image/png",
					data: atLimit,
				}),
			),
		),
	).toThrow("24 MiB");
});
