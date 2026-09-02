import type { AgentProfile } from "@gooseberry/contracts";

const OPERATION_LABELS: Record<keyof AgentProfile["operations"], string> = {
	deleteSession: "Delete chats",
	forkSession: "Fork chats",
	promptImage: "Image prompts",
	httpMcp: "HTTP MCP servers",
	steer: "Steer a running chat",
	renameSession: "Rename chats",
	archiveSession: "Archive chats",
	administration: "Agent administration",
};

export function AgentSettings({ profile }: { profile: AgentProfile }) {
	return (
		<div className="mx-auto flex w-full max-w-[36rem] flex-col gap-lg">
			<div>
				<h2 className="tr-title-entity text-text-default">{profile.name || "Connected agent"}</h2>
				<p className="mt-xs tr-text-ui text-text-muted">
					{profile.version ? `Version ${profile.version} · ` : ""}
					{profile.compatible ? "Compatible with Gooseberry" : "Missing required capabilities"}
				</p>
			</div>
			{profile.missingRequired.length > 0 ? (
				<div className="rounded-[var(--radius-sm)] border border-feedback-warning p-md">
					<h3 className="tr-text-ui text-text-default">Required capabilities</h3>
					<ul className="mt-xs list-disc pl-lg tr-text-metadata text-text-muted">
						{profile.missingRequired.map((capability) => (
							<li key={capability}>
								<code>{capability}</code>
							</li>
						))}
					</ul>
				</div>
			) : null}
			<div>
				<h3 className="tr-text-ui text-text-default">Optional capabilities</h3>
				<dl className="mt-sm divide-y divide-border-muted rounded-[var(--radius-sm)] border border-border-default">
					{Object.entries(profile.operations).map(([operation, available]) => (
						<div key={operation} className="flex items-center justify-between gap-md px-md py-sm">
							<dt className="tr-text-ui text-text-default">
								{OPERATION_LABELS[operation as keyof AgentProfile["operations"]]}
							</dt>
							<dd
								className={`tr-text-metadata ${available ? "text-feedback-success" : "text-text-muted"}`}
							>
								{available ? "Available" : "Unavailable"}
							</dd>
						</div>
					))}
				</dl>
			</div>
		</div>
	);
}
