<script lang="ts">
import ConfirmDialog from "../../components/confirm-dialog.svelte";
import { errorText, getTransport } from "../../connection";
import { appStoreApi, toast } from "../../store";
import type { SessionLifecycleTarget } from "./session-lifecycle";

interface Props {
	target: SessionLifecycleTarget;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}
let { target, open = $bindable(false), onOpenChange }: Props = $props();

function archive(): void {
	void getTransport()
		.request("session.archive", { projectId: target.projectId, sessionId: target.sessionId })
		.then(() =>
			appStoreApi.getState().applySessionLifecycle({
				projectId: target.projectId,
				sessionId: target.sessionId,
				operation: "archived",
			}),
		)
		.catch((cause) => toast.error(errorText(cause), "Couldn't archive the chat"));
}
</script>

<ConfirmDialog
	bind:open
	title="Archive this chat?"
	description="The agent will retain the conversation. You can restore it from chat history."
	confirmLabel="Archive"
	confirmTestId="session-archive-confirm"
	onConfirm={archive}
	{onOpenChange}
/>
