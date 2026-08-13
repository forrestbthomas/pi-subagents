/**
 * Per-tool-call timeout resolution (opt-in).
 *
 * Bounds a single subagent tool call inside the child event loops (async:
 * runPiStreaming; foreground: runSync). The knob is OPT-IN: when nothing is
 * configured anywhere the feature is off (undefined), so legit long tools
 * (installs, tests, migrations) and legit blocking tools (contact_supervisor,
 * intercom) are unaffected unless the caller opts in.
 *
 * Precedence ladder: per-call param > agent frontmatter > global config >
 * environment (PI_SUBAGENT_TOOL_TIMEOUT_MS). The env value is the lowest-tier
 * global default so hosts like pi-harness get a zero-config hook while any
 * explicit call/agent/config value still wins.
 *
 * Validation mirrors resolveConfigDefaultTimeoutMs: the value must be a
 * positive integer and must not exceed MAX_TIMER_DELAY_MS (values above the
 * 32-bit signed integer ceiling overflow setTimeout and fire almost
 * immediately). Invalid values are rejected with an error, not silently
 * ignored, so a misconfigured knob is visible to the caller.
 */

export const TOOL_TIMEOUT_ENV = "PI_SUBAGENT_TOOL_TIMEOUT_MS";

/** Maximum delay a Node.js timer accepts (32-bit signed integer ceiling). */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Tools that legitimately block on a human or supervisor decision. A blanket
 * per-tool deadline would kill these waits; they stay bounded by their own
 * mechanisms (e.g. DEFAULT_ASK_TIMEOUT_MS) and the run-level deadline.
 */
export const TOOL_TIMEOUT_ALLOWLIST = new Set(["contact_supervisor", "intercom"]);

export function isToolTimeoutExempt(toolName: string | undefined): boolean {
	return toolName !== undefined && TOOL_TIMEOUT_ALLOWLIST.has(toolName);
}

export interface ToolTimeoutResolutionInput {
	/** Per-call value from the subagent tool params (highest precedence). */
	callValue?: unknown;
	/** Agent frontmatter default (second precedence). */
	agentValue?: number;
	/** Global extension config.toolTimeoutMs (third precedence). */
	configValue?: unknown;
	/** PI_SUBAGENT_TOOL_TIMEOUT_MS environment override (lowest precedence). */
	envValue?: string | undefined;
}

/**
 * Resolve the effective opt-in per-tool-call timeout. Returns undefined when
 * nothing is configured (feature off). Returns an error string for an invalid
 * value at the winning tier.
 */
export function resolveToolTimeoutMs(input: ToolTimeoutResolutionInput): { toolTimeoutMs?: number; error?: string } {
	const candidates: Array<{ label: string; value: unknown }> = [
		{ label: "toolTimeoutMs", value: input.callValue },
		{ label: "agent.toolTimeoutMs", value: input.agentValue },
		{ label: "config.toolTimeoutMs", value: input.configValue },
	];
	let winner: { label: string; value: unknown } | undefined;
	for (const candidate of candidates) {
		if (candidate.value === undefined) continue;
		winner = candidate;
		break;
	}
	if (winner === undefined && input.envValue !== undefined && input.envValue.trim() !== "") {
		winner = { label: TOOL_TIMEOUT_ENV, value: input.envValue };
	}
	if (winner === undefined) return {};

	let raw: unknown = winner.value;
	let parsed: number;
	if (winner.label === TOOL_TIMEOUT_ENV && typeof raw === "string") {
		parsed = Number(raw);
		if (raw.trim() !== "" && !Number.isNaN(parsed)) {
			// Accept a plain integer string (e.g. "60000").
			raw = parsed;
		}
	}
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 || raw > MAX_TIMER_DELAY_MS) {
		return { error: `${winner.label} must be a positive integer no larger than ${MAX_TIMER_DELAY_MS}.` };
	}
	return { toolTimeoutMs: raw };
}

/** Read the environment override without requiring callers to know the name. */
export function toolTimeoutFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
	return env[TOOL_TIMEOUT_ENV];
}
