import 'dotenv/config';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

let env;
try {
  env = loadEnv();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const app = createApp(env);
const server = app.listen(env.PORT, () => {
  console.log(`CivicPlus+ backend listening on port ${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
