import { createAnthropic } from "@ai-sdk/anthropic";

// The one place the cell reaches a model, in exactly one of two modes:
//   sidecar — ANTHROPIC_BASE_URL is set and points at loopback; the key is the
//             per-run key `holon sidecar` minted. The OAuth grant never enters
//             this process.
//   api     — ANTHROPIC_BASE_URL is unset and a real API key is present (the
//             deployed mode, S6).
// Absence is the resting state, so it cannot also be the error signal: both
// modes are positive assertions and every other combination refuses to start.

export type ProviderMode = { kind: "sidecar"; baseURL: string; apiKey: string } | { kind: "api"; apiKey: string };

export const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function resolveMode(env: Record<string, string | undefined>): ProviderMode {
	const baseURL = env.ANTHROPIC_BASE_URL;
	const apiKey = env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error(
			"cell: no ANTHROPIC_API_KEY. Run under `holon sidecar -- <cmd>` (sidecar mode) or set a real key with no base URL (api mode).",
		);
	}
	if (baseURL === undefined || baseURL === "") {
		if (!apiKey.startsWith("sk-ant-api")) {
			throw new Error(
				"cell: api mode needs a real API key (sk-ant-api…); a sidecar key with no base URL would reach api.anthropic.com and fail.",
			);
		}
		return { kind: "api", apiKey };
	}
	let url: URL;
	try {
		url = new URL(baseURL);
	} catch {
		throw new Error(`cell: ANTHROPIC_BASE_URL is not a URL: ${baseURL}`);
	}
	if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
		throw new Error(
			`cell: ANTHROPIC_BASE_URL must be the loopback sidecar (http://127.0.0.1:<port>), got ${url.origin}`,
		);
	}
	if (apiKey.startsWith("sk-ant-")) {
		throw new Error(
			"cell: a real Anthropic credential is set alongside the sidecar base URL; the modes are never mixed.",
		);
	}
	return { kind: "sidecar", baseURL, apiKey };
}

export function cellModel(modelId: string, env: Record<string, string | undefined> = process.env) {
	const mode = resolveMode(env);
	const anthropic =
		mode.kind === "sidecar"
			? createAnthropic({ baseURL: mode.baseURL, apiKey: mode.apiKey })
			: // Explicit: createAnthropic would otherwise read ANTHROPIC_BASE_URL from
				// process.env, bypassing the env this function validated.
				createAnthropic({ apiKey: mode.apiKey, baseURL: ANTHROPIC_API_BASE });
	return anthropic(modelId);
}
