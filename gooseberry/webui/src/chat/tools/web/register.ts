import { registerToolRenderer } from "../../tool-registry";
import { strArg } from "../tool-helpers";
import { WebFetchCard } from "./web-fetch-card";
import { WebSearchCard } from "./web-search-card";

registerToolRenderer("web_search", WebSearchCard, { summary: ({ args }) => strArg(args, "query") });
registerToolRenderer("fetch_content", WebFetchCard, { summary: ({ args }) => strArg(args, "url") });
