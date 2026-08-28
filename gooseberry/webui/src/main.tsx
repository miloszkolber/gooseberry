import "./index.css";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ControllerAccess, logoutController } from "./auth";
import { ErrorBoundary } from "./components/error-boundary";
import { initNavigation } from "./navigation";
import { initProjectExpansionPersistence } from "./panels/project-expansion";
import { Shell } from "./shell/shell";
import { initTransport, resetTransport } from "./transport";

function App() {
	const [authenticated, setAuthenticated] = useState(false);
	const authenticate = useCallback(() => setAuthenticated(true), []);
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
		initProjectExpansionPersistence();
		initNavigation();
	}, [authenticated]);
	if (!authenticated) return <ControllerAccess onAuthenticated={authenticate} />;
	return (
		<>
			<button
				type="button"
				onClick={() => {
					void logoutController().finally(signOut);
				}}
				className="fixed right-md top-md z-50 border border-border-default bg-container-elevated-bg px-sm py-xs tr-text-metadata text-text-muted hover:text-text-default"
			>
				Sign out
			</button>
			<Shell />
		</>
	);
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
