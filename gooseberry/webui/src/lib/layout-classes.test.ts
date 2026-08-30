import { expect, test } from "bun:test";
import { cn } from "./utils";

test("custom spacing tokens yield to component layout overrides", () => {
	expect(cn("p-lg gap-lg", "p-0 gap-0")).toBe("p-0 gap-0");
	expect(cn("px-md py-xs", "p-sm")).toBe("p-sm");
	expect(cn("p-lg", "px-0")).toBe("p-lg px-0");
	expect(cn("p-lg sm:p-xl", "sm:p-0")).toBe("p-lg sm:p-0");
	expect(cn("h-panel-header-row", "h-8")).toBe("h-8");
});
