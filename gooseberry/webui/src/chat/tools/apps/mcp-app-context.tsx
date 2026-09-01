import { createContext, type ReactNode, useContext, useMemo } from "react";

interface McpAppSession {
	projectId: string;
	sessionId: string;
}

const McpAppSessionContext = createContext<McpAppSession | null>(null);

export function McpAppSessionProvider({
	projectId,
	sessionId,
	children,
}: {
	projectId: string | undefined;
	sessionId: string;
	children: ReactNode;
}) {
	const value = useMemo(
		() => (projectId ? { projectId, sessionId } : null),
		[projectId, sessionId],
	);
	return <McpAppSessionContext.Provider value={value}>{children}</McpAppSessionContext.Provider>;
}

export function useMcpAppSession(): McpAppSession | null {
	return useContext(McpAppSessionContext);
}
