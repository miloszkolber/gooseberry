import { describe, expect, it } from "bun:test";
import { decideSkill, isSkillLoaded, type SkillAdmissionContext } from "./skillAdmission";

const EMPTY: SkillAdmissionContext = {
	trusted: false,
	disabled: [],
	disabledGroups: [],
	overrides: {},
};
const projectSkill = (name: string, group = "project") => ({
	name,
	isProjectSkill: true,
	group,
	isPlugin: false,
});
const own = (name: string, group = "personal") => ({
	name,
	isProjectSkill: false,
	group,
	isPlugin: false,
});
const pluginSkill = (name: string, plugin: string) => ({
	name,
	isProjectSkill: false,
	group: plugin,
	isPlugin: true,
});

describe("decideSkill — native project trust", () => {
	it("withholds project skills until the project is trusted", () => {
		expect(decideSkill(projectSkill("deploy"), EMPTY)).toBe("untrusted");
		expect(decideSkill(projectSkill("deploy"), { ...EMPTY, trusted: true })).toBe("load");
	});

	it("never gates personal or Pi-native skills on project trust", () => {
		expect(decideSkill(own("brainstorming"), EMPTY)).toBe("load");
	});
});

describe("decideSkill — enable/disable", () => {
	it("project baseline disables a skill", () => {
		expect(decideSkill(own("noisy"), { ...EMPTY, disabled: ["noisy"] })).toBe("disabled");
	});

	it("a workspace 'off' override disables an otherwise-loaded skill", () => {
		expect(decideSkill(own("x"), { ...EMPTY, overrides: { x: "off" } })).toBe("disabled");
	});

	it("a workspace 'on' override re-enables a project-baseline-disabled skill", () => {
		expect(decideSkill(own("x"), { ...EMPTY, disabled: ["x"], overrides: { x: "on" } })).toBe(
			"load",
		);
	});
});

describe("decideSkill — trust is checked before toggles", () => {
	it("an 'on' override cannot un-gate an untrusted project skill", () => {
		expect(decideSkill(projectSkill("evil"), { ...EMPTY, overrides: { evil: "on" } })).toBe(
			"untrusted",
		);
	});
});

describe("decideSkill — group / source disable", () => {
	it("disables every skill in a disabled group", () => {
		expect(
			decideSkill(pluginSkill("x", "superpowers"), { ...EMPTY, disabledGroups: ["superpowers"] }),
		).toBe("disabled");
		expect(decideSkill(own("y", "personal"), { ...EMPTY, disabledGroups: ["personal"] })).toBe(
			"disabled",
		);
	});

	it("the @plugins super-toggle disables plugin skills but not personal skills", () => {
		const ctx = { ...EMPTY, disabledGroups: ["@plugins"] };
		expect(decideSkill(pluginSkill("x", "superpowers"), ctx)).toBe("disabled");
		expect(decideSkill(own("z", "personal"), ctx)).toBe("load");
	});

	it("a per-skill 'on' override re-enables one skill out of a disabled group", () => {
		expect(
			decideSkill(pluginSkill("x", "superpowers"), {
				...EMPTY,
				disabledGroups: ["superpowers"],
				overrides: { x: "on" },
			}),
		).toBe("load");
	});
});

describe("isSkillLoaded", () => {
	it("is true only for a 'load' verdict", () => {
		expect(isSkillLoaded(own("a"), EMPTY)).toBe(true);
		expect(isSkillLoaded(projectSkill("a"), EMPTY)).toBe(false);
	});
});
