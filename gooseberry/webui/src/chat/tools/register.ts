import { projectRelativePath } from "@/lib";
import { registerToolRenderer } from "../tool-registry";
import { AskUserQuestionCard } from "./ask-user-question-card";
import { BashCard } from "./bash-card";
import { EditCard } from "./edit-card";
import { ReadCard } from "./read-card";
import { strArg } from "./tool-helpers";
import "./web/register";
import { WriteCard } from "./write-card";
import "./browser/register";
import "./subagent/register";
import "./signet/register";

registerToolRenderer("bash", BashCard, { summary: ({ args }) => strArg(args, "command") });
registerToolRenderer("read", ReadCard, {
	summary: ({ args, projectAreaRoot }) =>
		projectRelativePath(strArg(args, "path"), projectAreaRoot),
});
registerToolRenderer("edit", EditCard, {
	summary: ({ args, projectAreaRoot }) =>
		projectRelativePath(strArg(args, "path"), projectAreaRoot),
});
registerToolRenderer("write", WriteCard, {
	summary: ({ args, projectAreaRoot }) =>
		projectRelativePath(strArg(args, "path"), projectAreaRoot),
});

registerToolRenderer("ask_user_question", AskUserQuestionCard, { chrome: "bare" });
