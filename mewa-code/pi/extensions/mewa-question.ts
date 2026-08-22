import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const questionSchema = Type.Object({
  prompt: Type.String({ description: "The question to ask the user." }),
  options: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional concise choices. Omit for a free-form answer.",
      maxItems: 10,
    }),
  ),
  allowCustom: Type.Optional(
    Type.Boolean({ description: "Allow a free-form answer in addition to listed choices." }),
  ),
});

export default function mewaQuestion(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "question",
    label: "question",
    description:
      "Ask the user one blocking question when a consequential decision, missing requirement, or required approval cannot be resolved from available evidence.",
    promptSnippet: "Ask the user a focused blocking question",
    promptGuidelines: [
      "Use question only for a real blocker, consequential choice, or required approval.",
      "Prefer one focused question with short options over several broad questions.",
      "Do not ask for information that can be inspected or inferred safely.",
    ],
    parameters: questionSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        throw new Error("Interactive user input is unavailable in this session.");
      }

      const options = params.options?.map((option) => option.trim()).filter(Boolean) ?? [];
      let answer: string | undefined;

      if (options.length > 0) {
        const customLabel = "Type another answer";
        const choices = params.allowCustom ? [...options, customLabel] : options;
        const selected = await ctx.ui.select(params.prompt, choices);
        if (selected === customLabel) {
          answer = await ctx.ui.input(params.prompt, "Enter your answer");
        } else {
          answer = selected;
        }
      } else {
        answer = await ctx.ui.input(params.prompt, "Enter your answer");
      }

      if (answer === undefined) {
        throw new Error("The user cancelled the question.");
      }

      return {
        content: [{ type: "text", text: answer }],
        details: { answer },
      };
    },
  });
}
