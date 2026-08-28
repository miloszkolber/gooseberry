import { getTransport } from "./wire-transport";

export function createAgentSession(input: { projectId: string; cwd?: string }) {
	return getTransport().request("session.create", input);
}

export function loadAgentSession(input: { projectId: string; sessionId: string }) {
	return getTransport().request("session.getMessages", input);
}
