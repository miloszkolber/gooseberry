<script lang="ts">
import type {
	GooseAutomationJobInspection,
	GooseAutomationRecipeEntry,
	GooseAutomationSchedule,
	GooseAutomationSession,
} from "@gooseberry/contracts";
import { onMount } from "svelte";
import Button from "@/components/button.svelte";
import { errorText, getTransport } from "@/connection";
import { appStoreApi } from "@/store";

let recipes = $state<GooseAutomationRecipeEntry[]>([]);
let schedules = $state<GooseAutomationSchedule[]>([]);
let recipeText = $state('{"title":"","description":""}');
let cron = $state("0 9 * * 1-5");
let selectedRecipe = $state("");
let scheduleCron = $state<Record<string, string>>({});
let recentSessions = $state<Record<string, GooseAutomationSession[]>>({});
let inspections = $state<Record<string, GooseAutomationJobInspection>>({});
let busy = $state(false);
let loadSequence = 0;
let busyInFlight = false;
let mounted = false;

function notifyError(error: unknown, title: string): void {
	appStoreApi.getState().pushToast({ variant: "error", message: errorText(error), title });
}

function notifySuccess(message: string): void {
	appStoreApi.getState().pushToast({ variant: "success", message });
}

async function load(): Promise<void> {
	const sequence = ++loadSequence;
	try {
		const [nextRecipes, nextSchedules] = await Promise.all([
			getTransport().request("goose.recipeList", {}),
			getTransport().request("goose.scheduleList", {}),
		]);
		if (!mounted || sequence !== loadSequence) return;
		recipes = nextRecipes;
		schedules = nextSchedules;
		scheduleCron = Object.fromEntries(
			nextSchedules.map((schedule) => [schedule.id, schedule.cron]),
		);
	} catch (error) {
		if (!mounted || sequence !== loadSequence) return;
		notifyError(error, "Goose automation is unavailable");
	}
}

async function runBusy(operation: () => Promise<void>, failureTitle: string): Promise<void> {
	if (busyInFlight) return;
	busyInFlight = true;
	busy = true;
	try {
		await operation();
	} catch (error) {
		notifyError(error, failureTitle);
	} finally {
		busyInFlight = false;
		if (mounted) busy = false;
	}
}

onMount(() => {
	mounted = true;
	void load();
	return () => {
		mounted = false;
		loadSequence += 1;
	};
});

function saveRecipe(): Promise<void> {
	return runBusy(async () => {
		const recipe = await getTransport().request("goose.recipeParse", { content: recipeText });
		await getTransport().request("goose.recipeSave", { recipe });
		await load();
	}, "Couldn't save recipe");
}

function createSchedule(): Promise<void> {
	return runBusy(async () => {
		const recipe = recipes.find((item) => item.id === selectedRecipe);
		if (!recipe) return;
		await getTransport().request("goose.scheduleCreate", {
			id: recipe.id,
			recipe: recipe.recipe,
			cron,
		});
		await load();
	}, "Couldn't create schedule");
}

function updateSchedule(scheduleId: string): Promise<void> {
	return runBusy(async () => {
		await getTransport().request("goose.scheduleUpdate", {
			scheduleId,
			cron: scheduleCron[scheduleId] ?? "",
		});
		await load();
	}, "Couldn't update schedule");
}

function loadRecentSessions(scheduleId: string): Promise<void> {
	return runBusy(async () => {
		const sessions = await getTransport().request("goose.scheduleSessions", { scheduleId });
		recentSessions = { ...recentSessions, [scheduleId]: sessions };
	}, "Couldn't load schedule sessions");
}

function inspectSchedule(scheduleId: string): Promise<void> {
	return runBusy(async () => {
		const inspection = await getTransport().request("goose.scheduleInspect", { scheduleId });
		inspections = { ...inspections, [scheduleId]: inspection };
	}, "Couldn't inspect the running schedule");
}

function killSchedule(scheduleId: string): Promise<void> {
	return runBusy(async () => {
		const result = await getTransport().request("goose.scheduleKill", { scheduleId });
		notifySuccess(result.message);
		const next = { ...inspections };
		delete next[scheduleId];
		inspections = next;
		await load();
	}, "Couldn't stop the running schedule");
}

function deleteRecipe(id: string): Promise<void> {
	return runBusy(async () => {
		await getTransport().request("goose.recipeDelete", { id });
		await load();
	}, "Couldn't delete recipe");
}

function changeScheduleState(schedule: GooseAutomationSchedule): Promise<void> {
	return runBusy(async () => {
		await getTransport().request(schedule.paused ? "goose.scheduleResume" : "goose.schedulePause", {
			scheduleId: schedule.id,
		});
		await load();
	}, "Couldn't change the schedule state");
}

function runScheduleNow(scheduleId: string): Promise<void> {
	return runBusy(async () => {
		await getTransport().request("goose.scheduleRunNow", { scheduleId });
		await load();
	}, "Couldn't run the schedule");
}

function deleteSchedule(scheduleId: string): Promise<void> {
	return runBusy(async () => {
		await getTransport().request("goose.scheduleDelete", { scheduleId });
		await load();
	}, "Couldn't delete the schedule");
}
</script>

<div data-testid="settings-goose-automation" class="flex flex-col gap-lg">
	<div>
		<h3 class="tr-title-section text-text-default">Goose automation</h3>
		<p class="text-text-muted tr-text-metadata">Recipes and schedules are stored and run by Goose.</p>
	</div>
	<section class="flex flex-col gap-sm">
		<h4 class="tr-text-eyebrow text-text-muted">Recipe JSON</h4>
		<textarea class="textarea min-h-28 tr-code-text" bind:value={recipeText} disabled={busy}></textarea>
		<div class="flex gap-sm">
			<Button size="sm" disabled={busy} onclick={() => void saveRecipe()}>Parse and save</Button>
			<Button
				size="sm"
				variant="outline"
				disabled={busy}
				onclick={() => void runBusy(load, "Goose automation is unavailable")}
			>
				Refresh
			</Button>
		</div>
		{#each recipes as entry (entry.id)}
			<div class="card flex items-center justify-between p-sm">
				<span class="min-w-0 truncate text-text-default">{entry.recipe.title || entry.id}</span>
				<Button size="sm" variant="ghost" disabled={busy} onclick={() => void deleteRecipe(entry.id)}>
					Delete
				</Button>
			</div>
		{/each}
	</section>

	<section class="flex flex-col gap-sm">
		<h4 class="tr-text-eyebrow text-text-muted">Schedule a recipe</h4>
		<div class="flex flex-wrap gap-sm">
			<select class="select" bind:value={selectedRecipe} disabled={busy}>
				<option value="">Select recipe</option>
				{#each recipes as entry (entry.id)}
					<option value={entry.id}>{entry.recipe.title || entry.id}</option>
				{/each}
			</select>
			<input
				class="text-field-input"
				bind:value={cron}
				aria-label="Cron schedule"
				disabled={busy}
			/>
			<Button size="sm" disabled={busy || !selectedRecipe} onclick={() => void createSchedule()}>
				Create
			</Button>
		</div>

		{#each schedules as schedule (schedule.id)}
			<div class="card flex flex-wrap items-center justify-between gap-sm p-sm">
				<div class="flex flex-wrap items-center gap-xs text-text-default">
					<span>{schedule.source} ·</span>
					{#if schedule.currentlyRunning}
						<span class="text-feedback-success tr-text-metadata">Running ·</span>
					{/if}
					<input
						class="text-field-input"
						aria-label={`Cron for ${schedule.source}`}
						value={scheduleCron[schedule.id] ?? schedule.cron}
						disabled={busy}
						oninput={(event) => {
							scheduleCron = { ...scheduleCron, [schedule.id]: event.currentTarget.value };
						}}
					/>
					<Button size="sm" variant="ghost" disabled={busy} onclick={() => void updateSchedule(schedule.id)}>
						Update
					</Button>
				</div>
				<div class="flex flex-wrap gap-xs">
					<Button size="sm" variant="ghost" disabled={busy} onclick={() => void changeScheduleState(schedule)}>
						{schedule.paused ? "Resume" : "Pause"}
					</Button>
					<Button size="sm" variant="ghost" disabled={busy} onclick={() => void runScheduleNow(schedule.id)}>
						Run now
					</Button>
					<Button size="sm" variant="ghost" disabled={busy} onclick={() => void loadRecentSessions(schedule.id)}>
						Recent sessions
					</Button>
					{#if schedule.currentlyRunning}
						<Button size="sm" variant="ghost" disabled={busy} onclick={() => void inspectSchedule(schedule.id)}>
							Inspect
						</Button>
						<Button size="sm" variant="ghost" disabled={busy} onclick={() => void killSchedule(schedule.id)}>
							Stop
						</Button>
					{/if}
					<Button size="sm" variant="ghost" disabled={busy} onclick={() => void deleteSchedule(schedule.id)}>
						Delete
					</Button>
				</div>
				{#if recentSessions[schedule.id] !== undefined}
					<div class="w-full text-text-muted tr-text-metadata">
						{#if recentSessions[schedule.id]?.length === 0}
							No recent sessions
						{:else}
							{#each recentSessions[schedule.id] ?? [] as value (`${value.sessionId ?? value.id}:${value.title ?? ""}`)}
								{@const id = value.sessionId ?? value.id ?? "unknown session"}
								{@const title = value.title ?? id}
								<div>{title}{title === id ? "" : ` · ${id}`}</div>
							{/each}
						{/if}
					</div>
				{/if}
				{#if inspections[schedule.id]}
					<div class="w-full text-text-muted tr-text-metadata">
						{inspections[schedule.id]?.running
							? `Session ${inspections[schedule.id]?.sessionId ?? "starting"} · ${inspections[schedule.id]?.runningDurationSeconds ?? 0}s`
							: "No running job"}
					</div>
				{/if}
			</div>
		{/each}
	</section>
</div>
