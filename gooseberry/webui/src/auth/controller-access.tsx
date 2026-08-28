import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface AuthStatus {
	authenticated: boolean;
}

async function authRequest(path: string, body?: Record<string, string>): Promise<Response> {
	const init: RequestInit = {
		method: body ? "POST" : "GET",
		credentials: "same-origin",
		cache: "no-store",
	};
	if (body) {
		init.headers = { "content-type": "application/json" };
		init.body = JSON.stringify(body);
	}
	return fetch(path, {
		...init,
	});
}

export function ControllerAccess({ onAuthenticated }: { onAuthenticated: () => void }) {
	const [status, setStatus] = useState<AuthStatus | undefined>();
	const [token, setToken] = useState("");
	const [error, setError] = useState("");

	useEffect(() => {
		void authRequest("/auth/status")
			.then(async (response) =>
				response.ok ? (response.json() as Promise<AuthStatus>) : undefined,
			)
			.then((next) => {
				if (next?.authenticated) onAuthenticated();
				else setStatus(next);
			})
			.catch(() => setError("Could not reach controller authentication."));
	}, [onAuthenticated]);

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError("");
		if (!status) return;
		const response = await authRequest("/auth/login", { token }).catch(() => undefined);
		if (!response?.ok) {
			setError("Authentication failed. Check the controller token and try again.");
			return;
		}
		onAuthenticated();
	};

	return (
		<main className="flex h-full items-center justify-center bg-container-content-bg p-lg">
			<section className="w-full max-w-[32rem] border border-border-default bg-container-elevated-bg p-xl">
				<div className="flex flex-col gap-xs">
					<h1 className="tr-title-dialog text-text-default">Connect to Gooseberry</h1>
					<p className="tr-text-ui text-text-muted">
						Enter the configured controller token. This browser stays authenticated for the
						configured period.
					</p>
				</div>
				{status ? (
					<form className="mt-lg flex flex-col gap-md" onSubmit={submit}>
						<label className="flex flex-col gap-xs tr-text-ui text-text-default">
							Controller token
							<input
								type="password"
								autoComplete="current-password"
								maxLength={256}
								value={token}
								onChange={(event) => setToken(event.target.value)}
								className="h-8 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-md text-text-default outline-none tr-text-ui focus-visible:ring-2 focus-visible:ring-primary"
							/>
						</label>
						{error ? (
							<p role="alert" className="tr-text-ui text-feedback-error">
								{error}
							</p>
						) : null}
						<div className="flex justify-end">
							<Button type="submit">Connect</Button>
						</div>
					</form>
				) : (
					<p className="mt-lg tr-text-ui text-text-muted">
						{error || "Checking controller authentication…"}
					</p>
				)}
			</section>
		</main>
	);
}

export async function logoutController(): Promise<void> {
	await authRequest("/auth/logout", {});
}
