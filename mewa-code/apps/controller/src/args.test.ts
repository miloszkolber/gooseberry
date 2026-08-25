import { describe, expect, test } from "bun:test";
import { DEFAULT_HOST, DEFAULT_PORT, parseArgs } from "./args";

describe("parseArgs", () => {
	test("defaults when no args or env", () => {
		expect(parseArgs([], {})).toEqual({
			port: DEFAULT_PORT,
			host: DEFAULT_HOST,
			open: true,
			staticDir: undefined,
			projectDir: undefined,
			acp: false,
			help: false,
			version: false,
		});
	});

	test("flags win over env over defaults", () => {
		const env = {
			MEWA_CODE_PORT: "9000",
			MEWA_CODE_HOST: "envhost",
			MEWA_CODE_STATIC_DIR: "/web/dist",
		};
		expect(parseArgs(["--port", "8080", "--host", "0.0.0.0"], env)).toMatchObject({
			port: 8080,
			host: "0.0.0.0",
			staticDir: "/web/dist",
		});
	});

	test("env fills in when a flag is absent", () => {
		expect(parseArgs([], { MEWA_CODE_PORT: "9000", MEWA_CODE_HOST: "envhost" })).toMatchObject({
			port: 9000,
			host: "envhost",
		});
	});

	test("supports --flag=value form", () => {
		expect(parseArgs(["--port=5000", "--host=h"], {})).toMatchObject({ port: 5000, host: "h" });
	});

	test("--no-open disables the browser", () => {
		expect(parseArgs(["--no-open"], {}).open).toBe(false);
	});

	test("--acp selects the Agent Client Protocol connector", () => {
		expect(parseArgs(["--acp"], {}).acp).toBe(true);
	});

	test("--help / -h set help", () => {
		expect(parseArgs(["--help"], {}).help).toBe(true);
		expect(parseArgs(["-h"], {}).help).toBe(true);
	});

	test("--version / -v set version", () => {
		expect(parseArgs(["--version"], {}).version).toBe(true);
		expect(parseArgs(["-v"], {}).version).toBe(true);
	});

	test("a positional arg is the project dir", () => {
		expect(parseArgs(["/path/to/repo"], {}).projectDir).toBe("/path/to/repo");
		expect(parseArgs(["--no-open", "/repo"], {}).projectDir).toBe("/repo");
	});

	test("throws on an unknown option", () => {
		expect(() => parseArgs(["--nope"], {})).toThrow("Unknown option: --nope");
	});

	test("throws on a missing flag value", () => {
		expect(() => parseArgs(["--port"], {})).toThrow("Missing value for --port");
	});

	test("throws on an unparseable / out-of-range port", () => {
		expect(() => parseArgs(["--port", "abc"], {})).toThrow("Invalid --port: abc");
		expect(() => parseArgs(["--port", "99999"], {})).toThrow("Invalid --port: 99999");
	});

	test("throws on a second positional arg", () => {
		expect(() => parseArgs(["/a", "/b"], {})).toThrow("Unexpected argument: /b");
	});

	test("ignores a non-numeric env port (falls back to default)", () => {
		expect(parseArgs([], { MEWA_CODE_PORT: "notanumber" }).port).toBe(DEFAULT_PORT);
	});
});
