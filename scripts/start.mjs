// Serves the built editor and the API from one process. Run "npm run build" first.
import { register } from 'tsx/esm/api';

process.env.NODE_ENV = 'production';
register();
await import('../src/server/index.ts');
