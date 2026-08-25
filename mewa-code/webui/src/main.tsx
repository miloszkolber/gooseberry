import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/error-boundary";
import { initNavigation } from "./navigation";
import { initProjectExpansionPersistence } from "./panels/project-expansion";
import { Shell } from "./shell/shell";
import { initTransport } from "./transport";

initTransport();
initProjectExpansionPersistence();
initNavigation();

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<ErrorBoundary label="app">
				<Shell />
			</ErrorBoundary>
		</StrictMode>,
	);
}
