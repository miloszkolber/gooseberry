import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { postPath, publishedPosts } from "../../blogCollection";

export async function GET(context: APIContext) {
	const posts = await publishedPosts();
	return rss({
		title: "Mewa Code Blog",
		description: "Updates, tutorials, and insights from the Mewa Code team.",
		site: context.site ?? "https://miloszkolber.github.io/mewa_code",
		items: posts.map((post) => ({
			title: post.data.title,
			description: post.data.excerpt,
			pubDate: post.data.date,
			link: postPath(post),
		})),
	});
}
