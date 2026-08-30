import { normalizeSessionGoal, SESSION_GOAL_MAX_LENGTH } from "@gooseberry/contracts";
import { Check, Circle, Pencil, Target, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useAppStore } from "@/store";
import { errorText, getTransport } from "../connection";

export function SessionGoalControl({
	projectAreaId,
	sessionId,
}: {
	projectAreaId: string;
	sessionId: string;
}) {
	const runtime = useAppStore((state) => state.sessions[sessionId]);
	const goalState = runtime?.goal ?? {
		projectAreaId: null,
		status: "idle" as const,
		goal: null,
		tasks: [],
		updatedAt: null,
		error: null,
	};
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(goalState.goal ?? "");
	const requestGeneration = useRef(0);

	const load = useCallback(() => {
		const generation = ++requestGeneration.current;
		useAppStore.getState().setSessionGoalLoading(sessionId, projectAreaId);
		void getTransport()
			.request("session.goalGet", { projectId: projectAreaId, sessionId })
			.then((value) => {
				if (generation !== requestGeneration.current) return;
				useAppStore.getState().setSessionGoal(sessionId, value);
				setDraft(value.goal ?? "");
			})
			.catch((error: unknown) => {
				if (generation !== requestGeneration.current) return;
				useAppStore.getState().setSessionGoalError(sessionId, projectAreaId, errorText(error));
			});
	}, [sessionId, projectAreaId]);

	useEffect(() => {
		setOpen(false);
		setDraft("");
		load();
		return () => {
			requestGeneration.current += 1;
		};
	}, [load]);

	const save = async (): Promise<void> => {
		let goal: string;
		try {
			goal = normalizeSessionGoal(draft);
		} catch (error) {
			useAppStore.getState().setSessionGoalError(sessionId, projectAreaId, errorText(error));
			return;
		}
		const generation = ++requestGeneration.current;
		useAppStore.getState().setSessionGoalSaving(sessionId, projectAreaId);
		try {
			const value = await getTransport().request("session.goalSet", {
				projectId: projectAreaId,
				sessionId,
				goal,
			});
			if (generation !== requestGeneration.current) return;
			useAppStore.getState().setSessionGoal(sessionId, value);
			setDraft(value.goal ?? "");
			setOpen(false);
		} catch (error) {
			if (generation !== requestGeneration.current) return;
			useAppStore.getState().setSessionGoalError(sessionId, projectAreaId, errorText(error));
		}
	};

	const clear = async (): Promise<void> => {
		const generation = ++requestGeneration.current;
		useAppStore.getState().setSessionGoalSaving(sessionId, projectAreaId);
		try {
			const value = await getTransport().request("session.goalClear", {
				projectId: projectAreaId,
				sessionId,
			});
			if (generation !== requestGeneration.current) return;
			useAppStore.getState().setSessionGoal(sessionId, value);
			setDraft("");
			setOpen(false);
		} catch (error) {
			if (generation !== requestGeneration.current) return;
			useAppStore.getState().setSessionGoalError(sessionId, projectAreaId, errorText(error));
		}
	};
	const beginEdit = () => {
		setDraft(goalState.goal ?? "");
		setOpen(true);
	};
	const busy = goalState.status === "loading" || goalState.status === "saving";
	const label =
		goalState.status === "loading"
			? "Loading goal…"
			: goalState.goal
				? `Goal: ${goalState.goal.replace(/\s+/g, " ")}`
				: "Set goal";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					data-testid="session-goal-control"
					aria-label={goalState.goal ? "Edit session goal" : "Set session goal"}
					disabled={busy}
					onClick={beginEdit}
					className="flex min-w-0 max-w-[min(36vw,24rem)] items-center gap-xs rounded-[var(--radius-sm)] px-sm py-0.5 text-text-muted tr-text-metadata outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:text-text-muted"
				>
					<Target className="size-3.5 shrink-0" aria-hidden />
					<span className="truncate">{label}</span>
					{goalState.goal ? <Pencil className="size-3 shrink-0" aria-hidden /> : null}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[min(90vw,28rem)] p-md">
				<form
					data-testid="session-goal-editor"
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
					className="flex flex-col gap-sm"
				>
					<div className="flex items-center justify-between gap-sm">
						<label htmlFor={`session-goal-${sessionId}`} className="tr-text-ui text-text-default">
							Session goal
						</label>
						<span className="text-text-muted tr-text-metadata">
							{draft.length}/{SESSION_GOAL_MAX_LENGTH}
						</span>
					</div>
					<Textarea
						id={`session-goal-${sessionId}`}
						data-testid="session-goal-input"
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder="What should this session accomplish?"
						maxLength={SESSION_GOAL_MAX_LENGTH + 1}
						rows={3}
						disabled={busy}
					/>
					{goalState.error ? (
						<div
							data-testid="session-goal-error"
							role="alert"
							className="text-feedback-error tr-text-metadata"
						>
							{goalState.error}
						</div>
					) : null}
					<div className="flex items-center justify-end gap-sm">
						{goalState.goal ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								data-testid="session-goal-clear"
								disabled={busy}
								onClick={() => void clear()}
							>
								<Trash2 className="size-3.5" />
								Clear
							</Button>
						) : null}
						{goalState.status === "error" && !goalState.goal ? (
							<Button type="button" variant="ghost" size="sm" onClick={load} disabled={busy}>
								Retry
							</Button>
						) : null}
						<Button
							type="submit"
							size="sm"
							data-testid="session-goal-save"
							disabled={busy || !draft.trim()}
						>
							Save
						</Button>
					</div>
				</form>
				<div className="mt-md flex flex-col gap-xs border-border-default border-t pt-md">
					<div className="flex items-center justify-between gap-sm">
						<div className="tr-text-ui text-text-default">Agent tasks</div>
						<span className="text-text-muted tr-text-metadata">Managed by the agent</span>
					</div>
					{goalState.tasks.map((task) => (
						<div key={task.id} className="flex items-center gap-xs">
							<span className="text-text-muted" title={task.status}>
								{task.status === "done" ? (
									<Check className="size-3.5" />
								) : (
									<Circle
										className={`size-3.5 ${task.status === "active" ? "text-primary" : ""}`}
									/>
								)}
							</span>
							<span
								className={`min-w-0 flex-1 tr-text-metadata ${task.status === "done" ? "text-text-muted line-through" : "text-text-default"}`}
							>
								{task.text}
							</span>
						</div>
					))}
					{goalState.tasks.length === 0 ? (
						<div className="text-text-muted tr-text-metadata">No tasks reported.</div>
					) : null}
				</div>
			</PopoverContent>
		</Popover>
	);
}
