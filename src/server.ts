import { getServerConfig, getSafeConfigDiagnostics } from './config/index.js';
import { buildApp } from './app.js';

const config = getServerConfig();
const PORT = config.port;
const HOST = config.host;

async function start() {
  try {
    const app = await buildApp();
    await app.listen({ port: PORT, host: HOST });
    console.log(`DORMEX Server running at http://${HOST}:${PORT} [NODE_ENV=${process.env.NODE_ENV || 'unset'}]`);

    // Graceful shutdown handlers for production orchestration (Render SIGTERM/SIGINT)
    const gracefulShutdown = async (signal: string) => {
      console.log(`Received ${signal}. Gracefully shutting down DORMEX server...`);
      try {
        await app.close();
        console.log('DORMEX server shut down cleanly.');
        process.exit(0);
      } catch (err) {
        console.error('Error during graceful shutdown:', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (err) {
    console.error('Failed to start DORMEX server:', err);
    process.exit(1);
  }
}

start();
