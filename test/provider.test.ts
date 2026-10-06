import { describe, expect, test } from "bun:test";
import { resolveMode } from "../agent/lib/provider";

const SIDECAR_KEY = "per-run-sidecar-key-not-a-secret";

describe("provider modes", () => {
	test("sidecar: loopback base URL and a per-run key", () => {
		expect(resolveMode({ ANTHROPIC_BASE_URL: "http://127.0.0.1:58660", ANTHROPIC_API_KEY: SIDECAR_KEY })).toEqual({
			kind: "sidecar",
			baseURL: "http://127.0.0.1:58660",
			apiKey: SIDECAR_KEY,
		});
		expect(resolveMode({ ANTHROPIC_BASE_URL: "http://localhost:8787", ANTHROPIC_API_KEY: SIDECAR_KEY }).kind).toBe(
			"sidecar",
		);
	});

	test("api: no base URL and a real key", () => {
		expect(resolveMode({ ANTHROPIC_API_KEY: "sk-ant-api03-x" }).kind).toBe("api");
	});

	test("refuses: no key at all", () => {
		expect(() => resolveMode({})).toThrow(/no ANTHROPIC_API_KEY/);
		expect(() => resolveMode({ ANTHROPIC_BASE_URL: "http://127.0.0.1:1" })).toThrow(/no ANTHROPIC_API_KEY/);
	});

	test("refuses: a non-loopback or non-http base URL", () => {
		for (const url of ["https://api.anthropic.com", "http://10.0.0.5:8787", "https://127.0.0.1:8787", "not a url"]) {
			expect(() => resolveMode({ ANTHROPIC_BASE_URL: url, ANTHROPIC_API_KEY: SIDECAR_KEY })).toThrow();
		}
	});

	test("refuses: modes mixed", () => {
		// A real credential next to the sidecar URL.
		expect(() =>
			resolveMode({ ANTHROPIC_BASE_URL: "http://127.0.0.1:1", ANTHROPIC_API_KEY: "sk-ant-api03-x" }),
		).toThrow(/never mixed/);
		expect(() =>
			resolveMode({ ANTHROPIC_BASE_URL: "http://127.0.0.1:1", ANTHROPIC_API_KEY: "sk-ant-oat01-x" }),
		).toThrow(/never mixed/);
		// A sidecar key with no sidecar.
		expect(() => resolveMode({ ANTHROPIC_API_KEY: SIDECAR_KEY })).toThrow(/api mode needs a real API key/);
	});
});

describe("cellModel", () => {
	test("builds an Anthropic model in either mode", async () => {
		const { cellModel } = await import("../agent/lib/provider");
		const sidecar = cellModel("claude-opus-5", {
			ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
			ANTHROPIC_API_KEY: SIDECAR_KEY,
		});
		expect(sidecar.modelId).toBe("claude-opus-5");
		expect(cellModel("claude-opus-5", { ANTHROPIC_API_KEY: "sk-ant-api03-x" }).modelId).toBe("claude-opus-5");
		expect(() => cellModel("claude-opus-5", {})).toThrow();
	});
});
