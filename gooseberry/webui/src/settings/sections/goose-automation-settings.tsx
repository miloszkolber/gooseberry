import type {
	GooseAutomationJobInspection,
	GooseAutomationRecipeEntry,
	GooseAutomationSchedule,
	GooseAutomationSession,
} from "@gooseberry/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/store";
import { errorText, getTransport } from "../../connection";

/** Goose owns recipe and scheduler persistence. Gooseberry only projects the useful controls. */
export function GooseAutomationSettings() {
	const [recipes, setRecipes] = useState<GooseAutomationRecipeEntry[]>([]);
	const [schedules, setSchedules] = useState<GooseAutomationSchedule[]>([]);
	const [recipeText, setRecipeText] = useState('{"title":"","description":""}');
	const [cron, setCron] = useState("0 9 * * 1-5");
	const [selectedRecipe, setSelectedRecipe] = useState("");
	const [scheduleCron, setScheduleCron] = useState<Record<string, string>>({});
	const [recentSessions, setRecentSessions] = useState<Record<string, GooseAutomationSession[]>>(
		{},
	);
	const [inspections, setInspections] = useState<Record<string, GooseAutomationJobInspection>>({});
	const [busy, setBusy] = useState(false);
	const loadSequence = useRef(0);
	const busyRef = useRef(false);
	const mounted = useRef(false);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			loadSequence.current += 1;
		};
	}, []);

	const load = useCallback(async () => {
		const sequence = ++loadSequence.current;
		try {
			const [nextRecipes, nextSchedules] = await Promise.all([
				getTransport().request("goose.recipeList", {}),
				getTransport().request("goose.scheduleList", {}),
			]);
			if (!mounted.current || sequence !== loadSequence.current) return;
			setRecipes(nextRecipes);
			setSchedules(nextSchedules);
			setScheduleCron(
				Object.fromEntries(nextSchedules.map((schedule) => [schedule.id, schedule.cron])),
			);
		} catch (error) {
			if (!mounted.current || sequence !== loadSequence.current) return;
			toast.error(errorText(error), "Goose automation is unavailable");
		}
	}, []);
	const runBusy = useCallback(async (operation: () => Promise<void>, failureTitle: string) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			await operation();
		} catch (error) {
			toast.error(errorText(error), failureTitle);
		} finally {
			busyRef.current = false;
			if (mounted.current) setBusy(false);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);
	const saveRecipe = () =>
		runBusy(async () => {
			const recipe = await getTransport().request("goose.recipeParse", {
				content: recipeText,
			});
			await getTransport().request("goose.recipeSave", { recipe });
			await load();
		}, "Couldn't save recipe");
	const createSchedule = () =>
		runBusy(async () => {
			const recipe = recipes.find((item) => item.id === selectedRecipe);
			if (!recipe) return;
			await getTransport().request("goose.scheduleCreate", {
				id: recipe.id,
				recipe: recipe.recipe,
				cron,
			});
			await load();
		}, "Couldn't create schedule");
	const updateSchedule = (scheduleId: string) =>
		runBusy(async () => {
			await getTransport().request("goose.scheduleUpdate", {
				scheduleId,
				cron: scheduleCron[scheduleId] ?? "",
			});
			await load();
		}, "Couldn't update schedule");
	const loadRecentSessions = (scheduleId: string) =>
		runBusy(async () => {
			const sessions = await getTransport().request("goose.scheduleSessions", {
				scheduleId,
			});
			setRecentSessions((current) => ({ ...current, [scheduleId]: sessions }));
		}, "Couldn't load schedule sessions");
	const inspectSchedule = (scheduleId: string) =>
		runBusy(async () => {
			const inspection = await getTransport().request("goose.scheduleInspect", { scheduleId });
			setInspections((current) => ({ ...current, [scheduleId]: inspection }));
		}, "Couldn't inspect the running schedule");
	const killSchedule = (scheduleId: string) =>
		runBusy(async () => {
			const result = await getTransport().request("goose.scheduleKill", { scheduleId });
			toast.success(result.message);
			setInspections((current) => {
				const next = { ...current };
				delete next[scheduleId];
				return next;
			});
			await load();
		}, "Couldn't stop the running schedule");
	const deleteRecipe = (id: string) =>
		runBusy(async () => {
			await getTransport().request("goose.recipeDelete", { id });
			await load();
		}, "Couldn't delete recipe");
	const changeScheduleState = (schedule: GooseAutomationSchedule) =>
		runBusy(async () => {
			await getTransport().request(
				schedule.paused ? "goose.scheduleResume" : "goose.schedulePause",
				{ scheduleId: schedule.id },
			);
			await load();
		}, "Couldn't change the schedule state");
	const runScheduleNow = (scheduleId: string) =>
		runBusy(async () => {
			await getTransport().request("goose.scheduleRunNow", { scheduleId });
			await load();
		}, "Couldn't run the schedule");
	const deleteSchedule = (scheduleId: string) =>
		runBusy(async () => {
			await getTransport().request("goose.scheduleDelete", { scheduleId });
			await load();
		}, "Couldn't delete the schedule");
	return (
		<div data-testid="settings-goose-automation" className="flex flex-col gap-lg">
			<div>
				<h3 className="tr-title-section text-text-default">Goose automation</h3>
				<p className="text-text-muted tr-text-metadata">
					Recipes and schedules are stored and run by Goose.
				</p>
			</div>
			<section className="flex flex-col gap-sm">
				<h4 className="tr-text-eyebrow text-text-muted">Recipe JSON</h4>
				<textarea
					value={recipeText}
					onChange={(event) => setRecipeText(event.target.value)}
					disabled={busy}
					className="min-h-28 rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-sm text-text-default tr-code-text"
				/>
				<div className="flex gap-sm">
					<Button size="sm" disabled={busy} onClick={() => void saveRecipe()}>
						Parse and save
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => void runBusy(load, "Goose automation is unavailable")}
					>
						Refresh
					</Button>
				</div>
				{recipes.map((entry) => (
					<div
						key={entry.id}
						className="flex items-center justify-between rounded-[var(--radius-sm)] border border-border-default p-sm"
					>
						<span className="min-w-0 truncate text-text-default">
							{entry.recipe.title || entry.id}
						</span>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => void deleteRecipe(entry.id)}
						>
							Delete
						</Button>
					</div>
				))}
			</section>
			<section className="flex flex-col gap-sm">
				<h4 className="tr-text-eyebrow text-text-muted">Schedule a recipe</h4>
				<div className="flex flex-wrap gap-sm">
					<select
						value={selectedRecipe}
						onChange={(event) => setSelectedRecipe(event.target.value)}
						disabled={busy}
						className="rounded border border-border-default bg-control-bg px-sm text-text-default"
					>
						<option value="">Select recipe</option>
						{recipes.map((entry) => (
							<option key={entry.id} value={entry.id}>
								{entry.recipe.title || entry.id}
							</option>
						))}
					</select>
					<input
						value={cron}
						onChange={(event) => setCron(event.target.value)}
						aria-label="Cron schedule"
						disabled={busy}
						className="rounded border border-border-default bg-control-bg px-sm text-text-default"
					/>
					<Button
						size="sm"
						disabled={busy || !selectedRecipe}
						onClick={() => void createSchedule()}
					>
						Create
					</Button>
				</div>
				{schedules.map((schedule) => (
					<div
						key={schedule.id}
						className="flex flex-wrap items-center justify-between gap-sm rounded-[var(--radius-sm)] border border-border-default p-sm"
					>
						<div className="flex flex-wrap items-center gap-xs text-text-default">
							<span>{schedule.source} ·</span>
							{schedule.currentlyRunning ? (
								<span className="text-feedback-success tr-text-metadata">Running ·</span>
							) : null}
							<input
								aria-label={`Cron for ${schedule.source}`}
								value={scheduleCron[schedule.id] ?? schedule.cron}
								onChange={(event) =>
									setScheduleCron((current) => ({ ...current, [schedule.id]: event.target.value }))
								}
								disabled={busy}
								className="rounded border border-border-default bg-control-bg px-xs text-text-default"
							/>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								onClick={() => void updateSchedule(schedule.id)}
							>
								Update
							</Button>
						</div>
						<div className="flex gap-xs">
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								onClick={() => void changeScheduleState(schedule)}
							>
								{schedule.paused ? "Resume" : "Pause"}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								onClick={() => void runScheduleNow(schedule.id)}
							>
								Run now
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								onClick={() => void loadRecentSessions(schedule.id)}
							>
								Recent sessions
							</Button>
							{schedule.currentlyRunning ? (
								<>
									<Button
										size="sm"
										variant="ghost"
										disabled={busy}
										onClick={() => void inspectSchedule(schedule.id)}
									>
										Inspect
									</Button>
									<Button
										size="sm"
										variant="ghost"
										disabled={busy}
										onClick={() => void killSchedule(schedule.id)}
									>
										Stop
									</Button>
								</>
							) : null}
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								onClick={() => void deleteSchedule(schedule.id)}
							>
								Delete
							</Button>
						</div>
						{recentSessions[schedule.id] !== undefined ? (
							<div className="w-full text-text-muted tr-text-metadata">
								{recentSessions[schedule.id]?.length === 0
									? "No recent sessions"
									: recentSessions[schedule.id]?.map((value) => {
											const id = value.sessionId ?? value.id ?? "unknown session";
											const title = value.title ?? id;
											return (
												<div key={`${id}:${title}`}>
													{title}
													{title === id ? "" : ` · ${id}`}
												</div>
											);
										})}
							</div>
						) : null}
						{inspections[schedule.id] ? (
							<div className="w-full text-text-muted tr-text-metadata">
								{inspections[schedule.id]?.running
									? `Session ${inspections[schedule.id]?.sessionId ?? "starting"} · ${inspections[schedule.id]?.runningDurationSeconds ?? 0}s`
									: "No running job"}
							</div>
						) : null}
					</div>
				))}
			</section>
		</div>
	);
}
