import { expect, test } from "bun:test";
import { forkActionState } from "./session-lifecycle-controls";

test("session fork action blocks running chats and labels an in-flight fork", () => {
	expect(forkActionState(true, false)).toEqual({
		disabled: true,
		label: "Fork",
		title: "Stop the running chat before forking it",
	});
	expect(forkActionState(false, true)).toEqual({ disabled: true, label: "Forking…" });
	expect(forkActionState(false, false)).toEqual({ disabled: false, label: "Fork" });
});
