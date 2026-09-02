import type { Project } from "@gooseberry/contracts";
import { Folder } from "lucide-react";
import type { ReactNode } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";

export function AddProjectMenu({
	recentProjects,
	onOpen,
	onOpenRecent,
	align = "end",
	children,
}: {
	recentProjects: Project[];
	onOpen: () => void;
	onOpenRecent: (path: string) => void;
	align?: "start" | "center" | "end";
	children: ReactNode;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent align={align}>
				<DropdownMenuItem data-testid="menu-open-project" onSelect={() => onOpen()}>
					<Folder />
					<span>Open project</span>
				</DropdownMenuItem>
				{recentProjects.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>Recents</DropdownMenuLabel>
						<DropdownMenuGroup>
							{recentProjects.map((project) => (
								<DropdownMenuItem
									key={project.id}
									onSelect={() => project.roots[0] && onOpenRecent(project.roots[0])}
									title={project.roots.join("\n")}
								>
									<Folder />
									<span className="truncate">{project.roots.join(", ")}</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
