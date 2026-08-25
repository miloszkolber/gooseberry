import type { Project, SkillCatalogEntry } from "@mewa-code/contracts";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

export function ProjectSkillsNotice({ projectId }: { projectId: string }) {
	const project = useAppStore((s) => s.projects.find((p) => p.id === projectId));
	const [skills, setSkills] = useState<SkillCatalogEntry[] | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setSkills(null);
		getTransport()
			.request("project.skills", { projectId })
			.then((entries) => {
				if (!cancelled) setSkills(entries.filter((entry) => entry.gated));
			})
			.catch(() => {
				if (!cancelled) setSkills([]);
			});
		return () => {
			cancelled = true;
		};
	}, [projectId]);

	if (!project || !skills || skills.length === 0) return null;

	const trusted = project.trusted === true;
	const untrusted = skills.filter((skill) => skill.decision === "untrusted");
	const count = skills.length;
	const plural = (n: number) => (n === 1 ? "" : "s");

	const applyProject = (updated: Project) => {
		useAppStore.getState().applyProjectUpdated(updated);
	};

	const trustProject = async () => {
		if (busy) return;
		setBusy(true);
		try {
			applyProject(
				await getTransport().request("project.setTrust", { id: projectId, trusted: true }),
			);
		} catch (err) {
			toast.error(errorText(err), "Couldn't trust project");
		} finally {
			setBusy(false);
		}
	};

	if (trusted && untrusted.length === 0) {
		return (
			<p
				data-testid="project-skills-notice"
				data-state="trusted"
				className="mt-lg flex items-center gap-xs text-text-muted tr-text-metadata"
			>
				<ShieldCheck className="size-3.5 shrink-0 text-feedback-warning" />
				{count} project skill{plural(count)} trusted.
			</p>
		);
	}

	return (
		<div
			data-testid="project-skills-notice"
			data-state="untrusted"
			className="mt-lg flex w-full max-w-[560px] items-center gap-sm rounded-[var(--radius-sm)] border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-md py-sm text-left"
		>
			<TriangleAlert className="size-4 shrink-0 text-feedback-warning" />
			<span className="min-w-0 flex-1 tr-text-ui text-text-default">
				This project ships {count} project skill{plural(count)} — off until you trust it.
			</span>
			<Button
				size="sm"
				data-testid="project-trust-button"
				disabled={busy}
				onClick={() => void trustProject()}
			>
				Trust project
			</Button>
		</div>
	);
}
