const MAX_WAIT_MS = 30_000;
const MAX_ARGS = 64;
const MAX_ARG_BYTES = 16 * 1024;

// Keep the API focused on the small set of operations needed for visual QA.
// In particular, state management, debugging, JavaScript evaluation, file
// access, and browser configuration commands must not be reachable through
// this service.
const navigationCommands = new Set(["open", "back", "forward", "reload"]);
const browserCommands = new Set(["close"]);
const interactionCommands = new Set([
	"click",
	"dblclick",
	"fill",
	"type",
	"hover",
	"focus",
	"check",
	"uncheck",
	"select",
	"press",
	"scroll",
	"scrollintoview",
	"wait",
]);
const observationCommands = new Set([
	"read",
	"snapshot",
	"screenshot",
	"get",
	"is",
	"a11y",
	"vitals",
]);
const visualCommands = new Set(["set"]);

export const allowedCommands = new Set([
	...navigationCommands,
	...browserCommands,
	...interactionCommands,
	...observationCommands,
	...visualCommands,
]);

const optionsByCommand = new Map([
	["read", new Set(["--json", "--timeout"])],
	["wait", new Set(["--json", "--timeout"])],
	[
		"snapshot",
		new Set(["--json", "-i", "--interactive", "-c", "--compact", "--depth", "--selector"]),
	],
	["screenshot", new Set(["--json", "--annotate"])],
	["a11y", new Set(["--json", "--selector", "--tags"])],
	["scroll", new Set(["--json", "--selector"])],
]);

const valueOptions = new Set(["--timeout", "--selector", "--depth", "--tags"]);
const booleanOptions = new Set(["--json", "-i", "-c", "--interactive", "--compact", "--annotate"]);

export class BrowserPolicyError extends Error {
	constructor(code, message, hint) {
		super(message);
		this.name = "BrowserPolicyError";
		this.code = code;
		this.hint = hint;
	}
}

function reject(message, hint = "use only the documented bounded browser operations") {
	throw new BrowserPolicyError("invalid_request", message, hint);
}

function permittedOptions(command) {
	return optionsByCommand.get(command) ?? new Set(["--json"]);
}

function isPositiveInteger(value, maximum) {
	return /^[1-9][0-9]{0,8}$/.test(value) && Number(value) <= maximum;
}

function safeHttpUrl(value) {
	if (
		!/^https?:\/\//.test(value) ||
		/\s/.test(value) ||
		value.split("").some((character) => character.charCodeAt(0) < 0x20)
	)
		return false;
	try {
		const url = new URL(value);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.hostname.length > 0 &&
			url.username === "" &&
			url.password === ""
		);
	} catch {
		return false;
	}
}

function rejectExecutableScheme(value) {
	const lowered = value.toLowerCase();
	if (/^(file|data|javascript|about|chrome|chrome-extension):/.test(lowered)) {
		reject(
			"local or executable URL schemes are not permitted",
			"use only plain http:// or https:// URLs",
		);
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !safeHttpUrl(value)) {
		reject(
			"URLs must be http(s) without embedded credentials",
			"remove credentials and use a plain http(s) URL",
		);
	}
}

function validateOption(command, option, value) {
	const allowed = permittedOptions(command);
	if (!allowed.has(option)) {
		reject(
			`option is not permitted for ${command}: ${option}`,
			`permitted options: ${[...allowed].join(" ") || "none"}`,
		);
	}
	if (option === "--timeout" && !isPositiveInteger(value, MAX_WAIT_MS)) {
		reject(`--timeout must be between 1 and ${MAX_WAIT_MS} milliseconds`);
	}
	if (option === "--depth" && !isPositiveInteger(value, 100)) {
		reject("--depth must be a whole number from 1 through 100");
	}
}

function parseArguments(command, rawArgs) {
	if (!Array.isArray(rawArgs)) reject("args must be an array");
	if (rawArgs.length > MAX_ARGS) reject(`too many arguments; maximum is ${MAX_ARGS}`);

	const args = rawArgs.map((value) => {
		if (typeof value !== "string") reject("every browser argument must be a string");
		if (Buffer.byteLength(value, "utf8") > MAX_ARG_BYTES) reject("browser argument is too large");
		if (value.includes("\u0000")) reject("browser arguments must not contain NUL bytes");
		rejectExecutableScheme(value);
		return value;
	});

	const positionals = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (booleanOptions.has(arg)) {
			validateOption(command, arg, "");
			continue;
		}
		if (valueOptions.has(arg)) {
			const value = args[index + 1];
			if (value === undefined || value.startsWith("-")) {
				reject(`${arg} requires a value`, `provide a value immediately after ${arg}`);
			}
			validateOption(command, arg, value);
			index += 1;
			continue;
		}
		if (arg.startsWith("-")) {
			reject(`option is not permitted: ${arg.split("=", 1)[0]}`);
		}
		positionals.push({ value: arg, index });
	}

	return { args, positionals };
}

function requireArity(command, values, minimum, maximum = minimum) {
	if (values.length < minimum || values.length > maximum) {
		const expected =
			minimum === maximum ? `exactly ${minimum}` : `between ${minimum} and ${maximum}`;
		reject(`${command} requires ${expected} positional argument${maximum === 1 ? "" : "s"}`);
	}
}

function requireSelector(command, values) {
	requireArity(command, values, 1);
}

function validatePositionals(command, parsed) {
	const values = parsed.positionals.map((entry) => entry.value);
	if (navigationCommands.has(command)) {
		if (command === "open" && (values.length !== 1 || !safeHttpUrl(values[0]))) {
			reject(`${command} requires exactly one http(s) URL without credentials`);
		}
		if (command !== "open") requireArity(command, values, 0);
	}
	if (browserCommands.has(command)) requireArity(command, values, 0);

	if (["read", "a11y", "vitals"].includes(command)) {
		if (values.length > 1 || (values.length === 1 && !safeHttpUrl(values[0]))) {
			reject(`${command} accepts at most one plain http(s) URL`);
		}
	}

	if (
		["click", "dblclick", "focus", "hover", "check", "uncheck", "scrollintoview"].includes(command)
	) {
		requireSelector(command, values);
	}

	if (["fill", "type", "select"].includes(command)) requireArity(command, values, 2);
	if (command === "press") requireArity(command, values, 1);

	if (command === "scroll") {
		requireArity(command, values, 1, 2);
		if (!"up down left right".split(" ").includes(values[0])) {
			reject("scroll direction must be up, down, left, or right");
		}
		if (values.length === 2 && !isPositiveInteger(values[1], 10_000)) {
			reject("scroll distance must be a whole number from 1 through 10000");
		}
	}

	if (command === "snapshot") requireArity(command, values, 0);

	if (command === "get") {
		const kinds = new Set([
			"text",
			"html",
			"value",
			"attr",
			"title",
			"url",
			"count",
			"box",
			"styles",
		]);
		if (values.length < 1 || !kinds.has(values[0])) {
			reject("get requires a permitted information type");
		}
		if (values[0] === "url" || values[0] === "title") {
			requireArity(command, values, 1);
		} else if (values[0] === "attr") {
			requireArity(command, values, 3);
		} else {
			requireArity(command, values, 2);
		}
	}

	if (command === "is") {
		const checks = new Set(["visible", "enabled", "checked"]);
		if (values.length !== 2 || !checks.has(values[0])) {
			reject("is requires one permitted state check and one selector");
		}
	}

	if (command === "wait") {
		if (values.length !== 1) reject("wait requires one selector or bounded millisecond value");
		if (/^[0-9]+$/.test(values[0]) && !isPositiveInteger(values[0], MAX_WAIT_MS)) {
			reject(`wait must be between 1 and ${MAX_WAIT_MS} milliseconds`);
		}
	}

	if (command === "set") {
		if (
			values.length !== 3 ||
			values[0] !== "viewport" ||
			!isPositiveInteger(values[1], 1920) ||
			!isPositiveInteger(values[2], 1200) ||
			Number(values[1]) < 320 ||
			Number(values[2]) < 240
		) {
			reject("set permits only viewport WIDTH HEIGHT within 320-1920 by 240-1200");
		}
	}

	if (command === "screenshot") {
		if (values.length !== 1) reject("screenshot requires one new output filename");
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.(png|jpe?g|webp)$/i.test(values[0])) {
			reject("screenshot output must be a simple png, jpg, jpeg, or webp filename");
		}
	}
}

export function validateBrowserRequest(body) {
	if (!body || typeof body !== "object" || Array.isArray(body))
		reject("request body must be an object");
	const keys = Object.keys(body);
	if (keys.some((key) => !["session", "command", "args"].includes(key))) {
		reject("request contains unknown fields");
	}
	const session = body.session;
	const command = body.command;
	if (typeof session !== "string" || !/^[A-Za-z0-9_-]{1,38}$/.test(session)) {
		reject("session must contain 1-38 letters, digits, underscores, or hyphens");
	}
	if (typeof command !== "string" || !allowedCommands.has(command)) {
		reject(`unsupported browser command: ${String(command)}`);
	}

	const parsed = parseArguments(command, body.args ?? []);
	validatePositionals(command, parsed);
	return { session, command, args: parsed.args, positionals: parsed.positionals };
}

export function screenshotFilename(request) {
	if (request.command !== "screenshot") return undefined;
	return request.positionals[0]?.value;
}
