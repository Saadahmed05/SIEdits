import path from 'node:path';
import type { ProviderEnv } from '../ai/registry';

const MB = 1024 * 1024;
export const DEFAULT_MAX_JSON_BYTES = 16 * MB;
export const DEFAULT_MAX_IMPORT_BYTES = 256 * MB;

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  /** Directory with the built editor (vite build output), served in production. */
  staticDir: string | null;
  providerEnv: ProviderEnv;
  maxUploadBytes: number;
  maxJsonBytes: number;
  maxImportBytes: number;
  /** Host names served besides loopback. Lower case, no ports. */
  allowedHosts: string[];
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
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 25) * MB,
    maxJsonBytes: env.MAX_JSON_MB ? Number(env.MAX_JSON_MB) * MB : DEFAULT_MAX_JSON_BYTES,
    maxImportBytes: env.MAX_IMPORT_MB ? Number(env.MAX_IMPORT_MB) * MB : DEFAULT_MAX_IMPORT_BYTES,
    allowedHosts: (env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  };
}
