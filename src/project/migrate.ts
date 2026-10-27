/**
 * Loading entry point for project documents of any version.
 *
 * When the format changes, bump PROJECT_VERSION in schema.ts and add a step to MIGRATIONS that
 * upgrades a document from version N to N+1. Migrations operate on plain JSON so they never
 * depend on the current TypeScript types.
 */
import { PROJECT_FORMAT, PROJECT_VERSION, parseProject, type ParseResult, type Project } from './schema';

type JsonObject = Record<string, unknown>;

/** MIGRATIONS[n] upgrades a version-n document to version n+1. */
const MIGRATIONS: Record<number, (doc: JsonObject) => JsonObject> = {};

export function loadProject(input: unknown): ParseResult<Project> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path: '(root)', message: 'a project must be a JSON object' }] };
  }
  let doc = input as JsonObject;
  if (doc.format !== PROJECT_FORMAT) {
    return {
      ok: false,
      issues: [{ path: 'format', message: `not a SceneWright project (expected format "${PROJECT_FORMAT}")` }],
    };
  }
  const version = doc.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, issues: [{ path: 'version', message: 'version must be a positive integer' }] };
  }
  if (version > PROJECT_VERSION) {
    return {
      ok: false,
      issues: [
        {
          path: 'version',
          message: `project version ${version} is newer than this SceneWright supports (${PROJECT_VERSION}); please upgrade`,
        },
      ],
    };
  }
  for (let v = version; v < PROJECT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, issues: [{ path: 'version', message: `no migration from version ${v}` }] };
    doc = step(doc);
  }
  return parseProject(doc);
}
