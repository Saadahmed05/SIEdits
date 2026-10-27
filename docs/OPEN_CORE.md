# Open-source core and possible hosted services

SceneWright is Apache-2.0. This document states what stays in the open-source core and where
optional paid services could attach later. Nothing here is implemented yet beyond the
interfaces named.

## Always in the open-source core

- The project format, validation, engine, preview and exporter.
- The editor, templates and all scene kinds/primitives in this repository.
- The deterministic planner and every AI provider adapter (bring your own key or local model).
- Import/export bundles — projects are never locked to a hosted service.

Local functionality will not be removed or degraded to push users to hosted services.

## Possible hosted services and their integration points

| Service | Plugs in through | Notes |
|---|---|---|
| Cloud rendering (parallel, GPU, 4K) | `RenderQueue` renderer function | Same project format; local rendering keeps working. Requires the H.264 licensing review in the license audit. |
| Hosted AI generation credits | `PlannerProvider` (and future `AssetProvider`) | An adapter like any other; users can always use their own keys. Default to commercially licensed models only. |
| Hosted storage & collaboration | `ProjectStore` | Accounts, sharing, comments, version history. |
| Team/agency workspaces | Server layer (auth not in core today) | Brand kits shared across projects. |
| Premium templates | `TEMPLATES` / scene-kind registries, distributed as packages | Templates are data + compilers; the core ships a free set. |
| Enterprise support / deployment | — | Docker images, SSO, on-prem renderers. |

## Prerequisites before any paid offering

- Authentication and per-user isolation (the current server is single-user, localhost-only).
- The unresolved items in [`research/LICENSE_AND_DEPENDENCY_AUDIT.md`](../research/LICENSE_AND_DEPENDENCY_AUDIT.md) §7.
