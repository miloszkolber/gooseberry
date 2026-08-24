---
id: module-website
type: module-design
status: draft
title: Project website preview
parent: architecture
tags: [website, marketing]
---

## Responsibility

The website package is an unpublished static preview of Mewa Code's product shell and documentation. It is not part of the product runtime, and no application package depends on it.

## Boundary

- Standalone Astro leaf with no Mewa Code workspace dependencies.
- Static output with vanilla TypeScript and hand-written CSS.
- Self-hosted fonts and no analytics, tracking pixels, provider credentials, or product telemetry.
- Product copy must describe implemented behavior. It must not advertise installers, releases, hosted URLs, teams, surveys, or launch material that do not exist for Mewa Code.
- The site may link to `https://github.com/miloszkolber/mewa_code` for source, issues, contribution guidance, and licensing.

## Development

Run `bun run --filter @mewa-code/website dev` for local preview and `bun run --filter @mewa-code/website build` for a static build. Deployment is intentionally deferred. A future publishing workflow must define the real site origin, include license attribution where appropriate, and pass the normal repository checks before it is enabled.

## Blog

The typed Astro content collection remains available for future documentation. Drafts may be previewed locally. Do not add announcement posts or distribution instructions until the referenced release channels exist.
