import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { AGENT_TERMINAL_WS_BASE_PATH } from "../generated/agent-terminal.ts";
import { createNodeAgentTerminalBridge, normalizeSpawnOptions } from "./agent-terminal.ts";
import { startAnnotateServer } from "./serverAnnotate.ts";
import { createTestEnvironment } from "../../../tests/helpers/environment";

const environment = createTestEnvironment(
	["PLANNOTATOR_REMOTE", "PLANNOTATOR_AGENT_TERMINAL_REMOTE", "PLANNOTATOR_PORT"],
	"plannotator-pi-agent-terminal-",
);
beforeEach(() => {
	environment.reset();
	process.env.PLANNOTATOR_REMOTE = "0";
	delete process.env.PLANNOTATOR_PORT;
});
afterEach(() => environment.restore());

describe("pi annotate agent terminal capability", () => {
	test("normalizes spawn options from the server-owned agent launch plan", () => {
		const normalized = normalizeSpawnOptions(
			{
				agent: "claude",
				command: "node -e 'throw new Error(\"client command ran\")'",
				cwd: "/client/cwd",
				env: { CLIENT_VALUE: "must-not-pass-through" },
				cols: 2000,
				rows: -5,
				startupCommandMode: "shell-command",
				preflightTrust: "cursor",
			},
			"/server/cwd",
			new Set(["claude"]),
			(options) => {
				expect(options).toEqual({
					agent: "claude",
					allowEmptyPromptLaunch: true,
				});
				return {
					agent: "claude",
					command: "claude",
					expectedProcess: "claude",
					env: { SERVER_VALUE: "safe" },
					followupPrompt: null,
					promptInjectionMode: "argv",
					preflightTrust: "codex",
					draftPasteReadySignal: null,
					promptDelivery: "none",
				};
			},
		);

		expect(normalized).toEqual({
			ok: true,
			value: {
				agent: "claude",
				command: "claude",
				cwd: "/server/cwd",
				startupCommandMode: "shell-ready",
				cols: 1000,
				env: { SERVER_VALUE: "safe" },
				preflightTrust: "codex",
			},
		});
	});

	test("reports disabled capability in remote mode without terminal opt-in", async () => {
		process.env.PLANNOTATOR_REMOTE = "1";
		delete process.env.PLANNOTATOR_AGENT_TERMINAL_REMOTE;
		const httpServer = createServer();

		try {
			const bridge = await createNodeAgentTerminalBridge({
				enabled: true,
				cwd: "/tmp/plannotator-agent-cwd",
				server: httpServer,
			});

			expect(bridge.capability).toMatchObject({
				enabled: false,
				reason: "remote-disabled",
			});
			bridge.dispose();
		} finally {
			httpServer.close();
		}
	});

	test("allows remote terminals only with explicit opt-in on their capability path", async () => {
		process.env.PLANNOTATOR_REMOTE = "1";
		process.env.PLANNOTATOR_AGENT_TERMINAL_REMOTE = "1";
		const httpServer = createServer();
		const bridge = await createNodeAgentTerminalBridge({
			enabled: true,
			cwd: "/tmp/plannotator-agent-cwd",
			server: httpServer,
		});
		try {
			expect(bridge.capability.enabled).toBe(true);
			if (!bridge.capability.enabled) throw new Error("Missing terminal capability");
			await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
			const address = httpServer.address();
			if (!address || typeof address === "string") throw new Error("Missing server address");
			const message = await websocketRoundTrip(
				`ws://127.0.0.1:${address.port}${bridge.capability.wsPath}`,
				{ type: "spawn", requestId: "remote-missing-agent", options: {} },
			);
			expect(JSON.parse(message)).toMatchObject({
				type: "error", requestId: "remote-missing-agent",
			});
		} finally {
			bridge.dispose();
			httpServer.close();
		}
	});

	test("annotate mode mirrors the same-port WebSocket capability", async () => {
		process.env.PLANNOTATOR_REMOTE = "0";
		const server = await startAnnotateServer({
			markdown: "# Annotate",
			filePath: "doc.md",
			htmlContent: "<html></html>",
			mode: "annotate",
			agentCwd: "/tmp/plannotator-agent-cwd",
		});

		try {
			const plan = await fetch(`${server.url}/api/plan`).then((res) => res.json());
			expect(plan.agentTerminal).toMatchObject({
				enabled: true,
				cwd: "/tmp/plannotator-agent-cwd",
			});
			expect(plan.agentTerminal.wsPath.startsWith(`${AGENT_TERMINAL_WS_BASE_PATH}/`)).toBe(true);
			expect(plan.agentTerminal.wsPath).not.toBe(AGENT_TERMINAL_WS_BASE_PATH);
			expect(plan.agentTerminal.agents.length).toBeGreaterThan(0);

			const message = await websocketRoundTrip(
				server.url.replace(/^http/, "ws") + plan.agentTerminal.wsPath,
				{ type: "spawn", requestId: "missing-agent", options: {} },
			);
			expect(JSON.parse(message)).toEqual({
				type: "error",
				requestId: "missing-agent",
				message: "Agent terminal requires a built-in WebTUI agent.",
			});

			await expect(
				websocketRoundTrip(
					server.url.replace(/^http/, "ws") + AGENT_TERMINAL_WS_BASE_PATH,
					{ type: "spawn", requestId: "static-path", options: {} },
				),
			).rejects.toThrow("WebSocket failed");
		} finally {
			server.stop();
		}
	});

	test("annotate-last keeps terminal support disabled", async () => {
		const server = await startAnnotateServer({
			markdown: "last message",
			filePath: "last-message",
			htmlContent: "<html></html>",
			mode: "annotate-last",
			agentCwd: "/tmp/plannotator-agent-cwd",
		});

		try {
			const plan = await fetch(`${server.url}/api/plan`).then((res) => res.json());
			expect(plan.agentTerminal).toEqual({
				enabled: false,
				reason: "not-annotate-mode",
			});
		} finally {
			server.stop();
		}
	});
});

function websocketRoundTrip(url: string, payload: unknown): Promise<string> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error("Timed out waiting for WebSocket response"));
		}, 5_000);

		ws.onopen = () => ws.send(JSON.stringify(payload));
		ws.onmessage = (event) => {
			clearTimeout(timer);
			ws.close();
			resolve(String(event.data));
		};
		ws.onerror = () => {
			clearTimeout(timer);
			reject(new Error("WebSocket failed"));
		};
	});
}
