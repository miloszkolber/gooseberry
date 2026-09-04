import { describe, expect, test } from "bun:test";
import {
	readFold,
	readSelection,
	selectValue,
	toggleFold,
	writeFold,
} from "@/chat/runtime/fold-state";

describe("persistent chat disclosure state", () => {
	test("retains explicit fold choices independently", () => {
		expect(readFold("fold-a", true)).toBe(true);
		expect(writeFold("fold-a", false)).toBe(false);
		expect(readFold("fold-a", true)).toBe(false);
		expect(toggleFold("fold-a", false)).toBe(true);
		expect(readFold("fold-b", false)).toBe(false);
	});

	test("selects and clears a detail row", () => {
		expect(readSelection("selection-a")).toBeNull();
		expect(selectValue("selection-a", null, "tool-1")).toBe("tool-1");
		expect(readSelection("selection-a")).toBe("tool-1");
		expect(selectValue("selection-a", "tool-1", "tool-1")).toBeNull();
	});
});
