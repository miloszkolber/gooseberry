import { projectRelativePath } from "@/lib";
import { registerToolRenderer } from "../toolRegistry";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { BashCard } from "./BashCard";
import { EditCard } from "./EditCard";
import { ReadCard } from "./ReadCard";
import { strArg } from "./toolHelpers";
import "./web/register";
import { WriteCard } from "./WriteCard";
import "./browser/register";
import "./subagent/register";
import "./signet/register";

registerToolRenderer("bash", BashCard, { summary: ({ args }) => strArg(args, "command") });
registerToolRenderer("read", ReadCard, {
	summary: ({ args, workspaceRoot }) => projectRelativePath(strArg(args, "path"), workspaceRoot),
});
registerToolRenderer("edit", EditCard, {
	summary: ({ args, workspaceRoot }) => projectRelativePath(strArg(args, "path"), workspaceRoot),
});
registerToolRenderer("write", WriteCard, {
	summary: ({ args, workspaceRoot }) => projectRelativePath(strArg(args, "path"), workspaceRoot),
});

registerToolRenderer("ask_user_question", AskUserQuestionCard, { chrome: "bare" });
