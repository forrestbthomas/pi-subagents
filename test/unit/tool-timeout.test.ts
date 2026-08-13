import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	TOOL_TIMEOUT_ALLOWLIST,
	TOOL_TIMEOUT_ENV,
	isToolTimeoutExempt,
	resolveToolTimeoutMs,
	toolTimeoutFromEnv,
} from "../../src/runs/shared/tool-timeout.ts";

describe("resolveToolTimeoutMs", () => {
	it("is off (undefined) when nothing is configured anywhere", () => {
		assert.deepEqual(resolveToolTimeoutMs({}), {});
	});

	it("honors precedence: per-call > agent frontmatter > config > env", () => {
		const input = {
			callValue: 1_000,
			agentValue: 2_000,
			configValue: 3_000,
			envValue: "4000",
		};
		assert.deepEqual(resolveToolTimeoutMs(input), { toolTimeoutMs: 1_000 });
		assert.deepEqual(resolveToolTimeoutMs({ ...input, callValue: undefined }), { toolTimeoutMs: 2_000 });
		assert.deepEqual(resolveToolTimeoutMs({ ...input, callValue: undefined, agentValue: undefined }), {
			toolTimeoutMs: 3_000,
		});
		assert.deepEqual(
			resolveToolTimeoutMs({ ...input, callValue: undefined, agentValue: undefined, configValue: undefined }),
			{ toolTimeoutMs: 4_000 },
		);
	});

	it("accepts the env value as a plain integer string", () => {
		assert.deepEqual(
			resolveToolTimeoutMs({ envValue: "60000", callValue: undefined, agentValue: undefined, configValue: undefined }),
			{ toolTimeoutMs: 60_000 },
		);
	});

	it("rejects non-positive, non-integer, and oversized values with an error", () => {
		for (const bad of [0, -1, 1.5, "abc", Number.NaN]) {
			const r = resolveToolTimeoutMs({ callValue: bad });
			assert.ok(r.error, `expected error for ${String(bad)}`);
			assert.match(r.error!, /positive integer/);
		}
		// Above the 32-bit signed integer ceiling setTimeout would overflow.
		const huge = resolveToolTimeoutMs({ callValue: 2_147_483_648 });
		assert.ok(huge.error);
		assert.match(huge.error!, /no larger than/);
	});

	it("ignores an empty env string (treated as unset)", () => {
		assert.deepEqual(resolveToolTimeoutMs({ envValue: "  " }), {});
	});
});

describe("isToolTimeoutExempt", () => {
	it("exempts supervisor tools that legitimately block on a human", () => {
		for (const tool of ["contact_supervisor", "intercom"]) {
			assert.equal(isToolTimeoutExempt(tool), true, `${tool} must be exempt`);
		}
	});

	it("does not exempt regular tools", () => {
		assert.equal(isToolTimeoutExempt("bash"), false);
		assert.equal(isToolTimeoutExempt(undefined), false);
	});

	it("allowlist contains exactly the supervisor pair", () => {
		assert.deepEqual([...TOOL_TIMEOUT_ALLOWLIST].sort(), ["contact_supervisor", "intercom"]);
	});
});

describe("toolTimeoutFromEnv", () => {
	it("reads PI_SUBAGENT_TOOL_TIMEOUT_MS from the process env", () => {
		assert.equal(TOOL_TIMEOUT_ENV, "PI_SUBAGENT_TOOL_TIMEOUT_MS");
		assert.equal(toolTimeoutFromEnv({ PI_SUBAGENT_TOOL_TIMEOUT_MS: "123" }), "123");
		assert.equal(toolTimeoutFromEnv({}), undefined);
	});
});
