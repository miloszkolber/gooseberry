import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/store";
import { errorText, getTransport } from "@/transport";

interface Recipe {
	title: string;
	description: string;
	[key: string]: unknown;
}
interface RecipeEntry {
	id: string;
	recipe: Recipe;
	filePath: string;
	lastModified: string;
	scheduleCron?: string;
}
interface Schedule {
	id: string;
	source: string;
	cron: string;
	paused: boolean;
	currentlyRunning: boolean;
	currentSessionId?: string;
	jobStartTime?: string;
}
interface RunningJobInspection {
	running: boolean;
	sessionId?: string;
	jobStartTime?: string;
	runningDurationSeconds?: number;
}

/** Goose owns recipe and scheduler persistence. Gooseberry only projects the useful controls. */
export function GooseAutomationSettings() {
	const [recipes, setRecipes] = useState<RecipeEntry[]>([]);
	const [schedules, setSchedules] = useState<Schedule[]>([]);
	const [recipeText, setRecipeText] = useState('{"title":"","description":""}');
	const [cron, setCron] = useState("0 9 * * 1-5");
	const [selectedRecipe, setSelectedRecipe] = useState("");
	const [scheduleCron, setScheduleCron] = useState<Record<string, string>>({});
	const [recentSessions, setRecentSessions] = useState<Record<string, unknown[]>>({});
	const [inspections, setInspections] = useState<Record<string, RunningJobInspection>>({});
	const load = useCallback(async () => {
		try {
			const [nextRecipes, nextSchedules] = await Promise.all([
				getTransport().request("goose.recipeList", {}),
				getTransport().request("goose.scheduleList", {}),
			]);
			setRecipes(nextRecipes as RecipeEntry[]);
			setSchedules(nextSchedules as Schedule[]);
			setScheduleCron(
				Object.fromEntries(
					(nextSchedules as Schedule[]).map((schedule) => [schedule.id, schedule.cron]),
				),
			);
		} catch (error) {
			toast.error(errorText(error), "Goose automation is unavailable");
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);
	const saveRecipe = async () => {
		try {
			const recipe = (await getTransport().request("goose.recipeParse", {
				content: recipeText,
			})) as Recipe;
			await getTransport().request("goose.recipeSave", { recipe });
			await load();
		} catch (error) {
			toast.error(errorText(error), "Couldn't save recipe");
		}
	};
	const createSchedule = async () => {
		const recipe = recipes.find((item) => item.id === selectedRecipe);
		if (!recipe) return;
		try {
			await getTransport().request("goose.scheduleCreate", {
				id: recipe.id,
				recipe: recipe.recipe,
				cron,
			});
			await load();
		} catch (error) {
			toast.error(errorText(error), "Couldn't create schedule");
		}
	};
	const updateSchedule = async (scheduleId: string) => {
		try {
			await getTransport().request("goose.scheduleUpdate", {
				scheduleId,
				cron: scheduleCron[scheduleId] ?? "",
			});
			await load();
		} catch (error) {
			toast.error(errorText(error), "Couldn't update schedule");
		}
	};
	const loadRecentSessions = async (scheduleId: string) => {
		try {
			const sessions = (await getTransport().request("goose.scheduleSessions", {
				scheduleId,
			})) as unknown[];
			setRecentSessions((current) => ({ ...current, [scheduleId]: sessions }));
		} catch (error) {
			toast.error(errorText(error), "Couldn't load schedule sessions");
		}
	};
	const inspectSchedule = async (scheduleId: string) => {
		try {
			const inspection = await getTransport().request("goose.scheduleInspect", { scheduleId });
			setInspections((current) => ({ ...current, [scheduleId]: inspection }));
		} catch (error) {
			toast.error(errorText(error), "Couldn't inspect the running schedule");
		}
	};
	const killSchedule = async (scheduleId: string) => {
		try {
			const result = await getTransport().request("goose.scheduleKill", { scheduleId });
			toast.success(result.message);
			setInspections((current) => {
				const next = { ...current };
				delete next[scheduleId];
				return next;
			});
			await load();
		} catch (error) {
			toast.error(errorText(error), "Couldn't stop the running schedule");
		}
	};
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
					className="min-h-28 rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-sm text-text-default tr-code-text"
				/>
				<div className="flex gap-sm">
					<Button size="sm" onClick={() => void saveRecipe()}>
						Parse and save
					</Button>
					<Button size="sm" variant="outline" onClick={() => void load()}>
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
							onClick={() =>
								void getTransport()
									.request("goose.recipeDelete", { id: entry.id })
									.then(load)
									.catch((error) => toast.error(errorText(error), "Couldn't delete recipe"))
							}
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
						className="rounded border border-border-default bg-control-bg px-sm text-text-default"
					/>
					<Button size="sm" disabled={!selectedRecipe} onClick={() => void createSchedule()}>
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
								className="rounded border border-border-default bg-control-bg px-xs text-text-default"
							/>
							<Button size="sm" variant="ghost" onClick={() => void updateSchedule(schedule.id)}>
								Update
							</Button>
						</div>
						<div className="flex gap-xs">
							<Button
								size="sm"
								variant="ghost"
								onClick={() =>
									void getTransport()
										.request(schedule.paused ? "goose.scheduleResume" : "goose.schedulePause", {
											scheduleId: schedule.id,
										})
										.then(load)
										.catch((error) =>
											toast.error(errorText(error), "Couldn't change the schedule state"),
										)
								}
							>
								{schedule.paused ? "Resume" : "Pause"}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() =>
									void getTransport()
										.request("goose.scheduleRunNow", { scheduleId: schedule.id })
										.then(load)
										.catch((error) => toast.error(errorText(error), "Couldn't run the schedule"))
								}
							>
								Run now
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => void loadRecentSessions(schedule.id)}
							>
								Recent sessions
							</Button>
							{schedule.currentlyRunning ? (
								<>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => void inspectSchedule(schedule.id)}
									>
										Inspect
									</Button>
									<Button size="sm" variant="ghost" onClick={() => void killSchedule(schedule.id)}>
										Stop
									</Button>
								</>
							) : null}
							<Button
								size="sm"
								variant="ghost"
								onClick={() =>
									void getTransport()
										.request("goose.scheduleDelete", { scheduleId: schedule.id })
										.then(load)
										.catch((error) => toast.error(errorText(error), "Couldn't delete the schedule"))
								}
							>
								Delete
							</Button>
						</div>
						{recentSessions[schedule.id] !== undefined ? (
							<div className="w-full text-text-muted tr-text-metadata">
								{recentSessions[schedule.id]?.length === 0
									? "No recent sessions"
									: recentSessions[schedule.id]?.map((value) => {
											const record =
												value && typeof value === "object" && !Array.isArray(value)
													? (value as Record<string, unknown>)
													: {};
											const id =
												typeof record.sessionId === "string"
													? record.sessionId
													: typeof record.id === "string"
														? record.id
														: "unknown session";
											const title = typeof record.title === "string" ? record.title : id;
											return (
												<div
													key={typeof value === "object" ? JSON.stringify(value) : String(value)}
												>
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
