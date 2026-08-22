import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls", "question", "browser"];
const WRITE_TOOLS = new Set(["edit", "write"]);
const READ_ONLY_COMMAND = /^(?:\s*(?:pwd|ls|find|fd|rg|grep|cat|sed\s+-n|head|tail|wc|stat|file|git\s+(?:status|diff|log|show|branch|rev-parse)|go\s+(?:list|env)|uv\s+(?:tree|lock\s+--check)|npm\s+(?:test|run|view)|node\s+--check)\b)/;

type PlanState = {
  enabled: boolean;
  previousTools?: string[];
};

export default function mewaPlan(pi: ExtensionAPI): void {
  let enabled = false;
  let previousTools: string[] | undefined;

  function persist(): void {
    pi.appendEntry<PlanState>("mewa-plan", { enabled, previousTools });
  }

  function apply(ctx: ExtensionContext): void {
    if (enabled) {
      previousTools ??= pi.getActiveTools();
      const retained = previousTools.filter((name) => !WRITE_TOOLS.has(name));
      pi.setActiveTools([...new Set([...retained, ...READ_ONLY_TOOLS])]);
      ctx.ui.setStatus("mewa-plan", "plan");
    } else {
      if (previousTools) pi.setActiveTools(previousTools);
      previousTools = undefined;
      ctx.ui.setStatus("mewa-plan", undefined);
    }
  }

  pi.registerCommand("plan", {
    description: "Toggle read-only planning mode.",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      apply(ctx);
      persist();
      ctx.ui.notify(enabled ? "Plan mode enabled." : "Plan mode disabled.", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const saved = ctx.sessionManager
      .getEntries()
      .filter(
        (entry): entry is typeof entry & { customType: string; data?: PlanState } =>
          entry.type === "custom" && "customType" in entry && entry.customType === "mewa-plan",
      )
      .at(-1);
    enabled = saved?.data?.enabled ?? false;
    previousTools = saved?.data?.previousTools;
    apply(ctx);
  });

  pi.on("tool_call", async (event) => {
    if (!enabled) return;
    if (WRITE_TOOLS.has(event.toolName)) {
      return { block: true, reason: "Plan mode is read-only. Disable it with /plan before editing files." };
    }
    if (event.toolName === "bash") {
      const command = typeof event.input.command === "string" ? event.input.command : "";
      if (!READ_ONLY_COMMAND.test(command)) {
        return {
          block: true,
          reason: `Plan mode blocked a non-read-only shell command: ${command || "(empty command)"}`,
        };
      }
    }
  });

  pi.on("before_agent_start", async () => {
    if (!enabled) return;
    return {
      message: {
        customType: "mewa-plan-context",
        display: false,
        content: `[PLAN MODE]\nInvestigate and decide, but do not modify files or persistent state.\nUse read-only tools and ask focused questions only when a consequential blocker remains.\nReturn a concrete plan with verification and rollback steps where relevant.`,
      },
    };
  });
}
