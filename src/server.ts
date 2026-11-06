import { buildApp } from './app.js';

const isProduction = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT || '3000', 10);
// Production must bind to 0.0.0.0 to accept traffic from Render proxy; local dev defaults to 127.0.0.1
const HOST = process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1');

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
