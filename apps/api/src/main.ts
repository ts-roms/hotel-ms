import { createApp } from './app.factory.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = await createApp(env);
await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
