import { existsSync, mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createProviders } from '../ai/registry';
import { ffmpegVersion } from '../render/ffmpeg';
import { createApp } from './app';
import { loadConfig } from './config';
import { RenderQueue } from './jobs';
import { ProjectStore } from './storage';

// Optional .env in the working directory (Node's built-in loader; real env vars take precedence).
if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
if (config.staticDir && !existsSync(config.staticDir)) {
  console.error(`Built editor not found at ${config.staticDir}. Run "npm run build" first.`);
  process.exit(1);
}

const store = new ProjectStore(config.dataDir);
mkdirSync(store.projectsDir, { recursive: true });
mkdirSync(store.rendersRoot, { recursive: true });

const providers = createProviders(config.providerEnv);
const app = createApp({
  store,
  queue: new RenderQueue(),
  providers,
  ffmpegVersion: () => ffmpegVersion(),
  maxUploadBytes: config.maxUploadBytes,
  staticDir: config.staticDir,
});

const version = await ffmpegVersion();
serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`SceneWright API listening on http://${config.host}:${info.port}`);
  console.log(`  data:    ${config.dataDir}`);
  console.log(`  ffmpeg:  ${version ?? 'NOT FOUND — rendering is disabled until FFmpeg is installed'}`);
  console.log(`  planners: ${providers.map((p) => `${p.id}${p.isConfigured() ? '' : ' (not configured)'}`).join(', ')}`);
  if (config.staticDir) console.log(`  editor:  http://${config.host}:${info.port}/`);
});
