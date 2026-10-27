import path from 'node:path';
import type { ProviderEnv } from '../ai/registry';

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  /** Directory with the built editor (vite build output), served in production. */
  staticDir: string | null;
  providerEnv: ProviderEnv;
  maxUploadBytes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`invalid PORT "${env.PORT}"`);
  return {
    host: env.HOST || '127.0.0.1',
    port,
    dataDir: path.resolve(env.DATA_DIR || 'data'),
    staticDir: env.NODE_ENV === 'production' ? path.resolve(env.STATIC_DIR || 'dist') : null,
    providerEnv: env,
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024,
  };
}
