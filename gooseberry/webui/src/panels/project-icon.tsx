import type { ProjectIcon as ProjectIconName } from "@gooseberry/contracts";
import {
	BookOpen,
	Code2,
	FlaskConical,
	Folder,
	type LucideProps,
	Rocket,
	Sparkles,
} from "lucide-react";
import type { ComponentType } from "react";

const ICONS = {
	folder: Folder,
	code: Code2,
	book: BookOpen,
	flask: FlaskConical,
	rocket: Rocket,
	sparkles: Sparkles,
} satisfies Record<ProjectIconName, ComponentType<LucideProps>>;

export function ProjectIcon({
	icon = "folder",
	...props
}: LucideProps & { icon?: ProjectIconName }) {
	const Icon = ICONS[icon];
	return <Icon {...props} />;
}
