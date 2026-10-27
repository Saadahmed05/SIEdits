/** Writes docs/project.schema.json (JSON Schema for project files) from the Zod schema. */
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { ProjectSchema } from '../src/project/schema';

const schema = z.toJSONSchema(ProjectSchema, { io: 'input', unrepresentable: 'any' });
await writeFile('docs/project.schema.json', `${JSON.stringify({ title: 'SceneWright project (v1)', ...schema }, null, 2)}\n`);
console.log('wrote docs/project.schema.json');
