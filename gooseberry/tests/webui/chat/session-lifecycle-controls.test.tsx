import { expect, test } from "bun:test";
import { forkActionState, unsupportedLifecycleReason } from "@/chat/session-lifecycle-controls";

test("session fork action blocks running chats and labels an in-flight fork", () => {
	expect(forkActionState(true, false)).toEqual({
		disabled: true,
		label: "Fork",
		title: "Stop the running chat before forking it",
	});
	expect(forkActionState(false, true)).toEqual({ disabled: true, label: "Forking…" });
	expect(forkActionState(false, false)).toEqual({ disabled: false, label: "Fork" });
});

test("unsupported lifecycle actions carry an agent-specific explanation", () => {
	expect(forkActionState(false, false, false, "Example agent")).toEqual({
		disabled: true,
		label: "Fork",
		title: "Example agent does not support forking chats",
	});
	expect(unsupportedLifecycleReason("Example agent", "deleting")).toBe(
		"Example agent does not support deleting chats",
	);
});
