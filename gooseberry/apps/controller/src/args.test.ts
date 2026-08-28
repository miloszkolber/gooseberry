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
			help: false,
			version: false,
		});
	});

	test("flags win over env over defaults", () => {
		const env = {
			GOOSEBERRY_PORT: "9000",
			GOOSEBERRY_HOST: "envhost",
			GOOSEBERRY_STATIC_DIR: "/web/dist",
		};
		expect(parseArgs(["--port", "8080", "--host", "0.0.0.0"], env)).toMatchObject({
			port: 8080,
			host: "0.0.0.0",
			staticDir: "/web/dist",
		});
	});

	test("env fills in when a flag is absent", () => {
		expect(parseArgs([], { GOOSEBERRY_PORT: "9000", GOOSEBERRY_HOST: "envhost" })).toMatchObject({
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

	test("uses GOOSEBERRY_PROJECT_PATH when no positional project is given", () => {
		expect(parseArgs([], { GOOSEBERRY_PROJECT_PATH: "/repo" }).projectDir).toBe("/repo");
		expect(parseArgs(["/workspace"], { GOOSEBERRY_PROJECT_PATH: "/repo" }).projectDir).toBe(
			"/workspace",
		);
	});

	test("throws on an unknown option", () => {
		expect(() => parseArgs(["--nope"], {})).toThrow("Unknown option: --nope");
	});

	test("throws on a missing flag value", () => {
		expect(() => parseArgs(["--port"], {})).toThrow("Missing value for --port");
	});

	test("throws on an unparseable / out-of-range port", () => {
		expect(() => parseArgs(["--port", "abc"], {})).toThrow("Invalid --port: abc");
		expect(() => parseArgs(["--port", "0"], {})).toThrow("Invalid --port: 0");
		expect(() => parseArgs(["--port", "99999"], {})).toThrow("Invalid --port: 99999");
	});

	test("throws on a second positional arg", () => {
		expect(() => parseArgs(["/a", "/b"], {})).toThrow("Unexpected argument: /b");
	});

	test("accepts a valid env port", () => {
		expect(parseArgs([], { GOOSEBERRY_PORT: "7312" }).port).toBe(7312);
	});

	test("throws clear errors for invalid env ports", () => {
		for (const value of ["0", "65536", "notanumber"]) {
			expect(() => parseArgs([], { GOOSEBERRY_PORT: value })).toThrow(
				`Invalid GOOSEBERRY_PORT: ${value}`,
			);
		}
	});

	test("validates host consistently across flags and env", () => {
		expect(() => parseArgs(["--host", ""], {})).toThrow("Invalid --host:");
		expect(() => parseArgs([], { GOOSEBERRY_HOST: " " })).toThrow("Invalid GOOSEBERRY_HOST:");
	});
});
