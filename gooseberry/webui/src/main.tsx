import "./index.css";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/error-boundary";
import { ControllerAccess, initTransport, resetTransport } from "./connection";
import { useAppStore } from "./store";
import { initNavigation } from "./workspace/navigation";
import { initProjectExpansionPersistence } from "./workspace/project-expansion";
import { Shell } from "./workspace/shell";

function App() {
	const [authenticated, setAuthenticated] = useState(false);
	const authenticate = useCallback((authenticationEnabled: boolean) => {
		useAppStore.getState().setAuthenticationEnabled(authenticationEnabled);
		setAuthenticated(true);
	}, []);
	const signOut = useCallback(() => {
		resetTransport();
		setAuthenticated(false);
	}, []);
	useEffect(() => {
		window.addEventListener("gooseberry-auth-lost", signOut);
		return () => window.removeEventListener("gooseberry-auth-lost", signOut);
	}, [signOut]);
	useEffect(() => {
		if (!authenticated) return;
		initTransport();
		const stopExpansionPersistence = initProjectExpansionPersistence();
		const stopNavigation = initNavigation();
		return () => {
			stopNavigation();
			stopExpansionPersistence();
		};
	}, [authenticated]);
	if (!authenticated) return <ControllerAccess onAuthenticated={authenticate} />;
	return <Shell />;
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<ErrorBoundary label="app">
				<App />
			</ErrorBoundary>
		</StrictMode>,
	);
}
