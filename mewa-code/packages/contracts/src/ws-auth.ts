/**
 * The controller WebSocket token is carried in a negotiated subprotocol rather
 * than in the URL or an application frame. The encoded value is deliberately
 * strict so malformed protocol headers fail closed on both sides.
 */
export const WS_AUTH_PROTOCOL_PREFIX = "mewa-code.v1.";
export const CODE_TOKEN_MIN_LENGTH = 32;
export const CODE_TOKEN_MAX_LENGTH = 256;

/** Values intentionally shipped in documentation as setup sentinels. */
export const TOKEN_SENTINELS = [
	"INVALID_REPLACE_WITH_RANDOM_CONTROLLER_TOKEN",
	"INVALID_REPLACE_WITH_RANDOM_BROWSER_TOKEN",
	"replace-with-a-random-controller-token",
	"replace-with-a-random-browser-token",
	"replace-with-a-random-token",
] as const;

const CODE_TOKEN_PATTERN = /^[\x21-\x7e]+$/;
const ENCODED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{2,342}$/;

/** Validate a printable token suitable for controller and browser authentication. */
export function isStrongToken(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length >= CODE_TOKEN_MIN_LENGTH &&
		value.length <= CODE_TOKEN_MAX_LENGTH &&
		CODE_TOKEN_PATTERN.test(value) &&
		!(TOKEN_SENTINELS as readonly string[]).includes(value)
	);
}

export function isCodeToken(value: unknown): value is string {
	return isStrongToken(value);
}

function encodeBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Return the WebSocket subprotocol for a validated controller token. */
export function encodeCodeTokenProtocol(token: string): string | undefined {
	if (!isCodeToken(token)) return undefined;
	return `${WS_AUTH_PROTOCOL_PREFIX}${encodeBase64Url(new TextEncoder().encode(token))}`;
}

/**
 * Decode and strictly validate a controller-token WebSocket subprotocol.
 * Canonical re-encoding rejects alternate or non-zero-padded base64 forms.
 */
export function decodeCodeTokenProtocol(protocol: unknown): string | undefined {
	if (typeof protocol !== "string" || !protocol.startsWith(WS_AUTH_PROTOCOL_PREFIX))
		return undefined;
	const encoded = protocol.slice(WS_AUTH_PROTOCOL_PREFIX.length);
	if (!ENCODED_TOKEN_PATTERN.test(encoded) || encoded.length % 4 === 1) return undefined;

	const padded = `${encoded}${"=".repeat((4 - (encoded.length % 4)) % 4)}`;
	let binary: string;
	try {
		binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
	} catch {
		return undefined;
	}

	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	let token: string;
	try {
		token = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return undefined;
	}
	if (!isCodeToken(token) || encodeCodeTokenProtocol(token) !== protocol) return undefined;
	return token;
}
