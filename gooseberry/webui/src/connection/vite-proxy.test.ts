import { expect, test } from "bun:test";
import config from "../../vite.config";

test("local development proxies authentication and WebSockets to the same controller", () => {
	const resolved = config as { server?: { proxy?: Record<string, unknown> } };
	const proxy = resolved.server?.proxy;
	expect(proxy?.["/auth"]).toBe("http://127.0.0.1:7312");
	expect(proxy?.["/ws"]).toEqual({ target: "ws://127.0.0.1:7312", ws: true });
});
