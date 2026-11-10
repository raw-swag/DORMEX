import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production' || process.env.NODE_ENV === 'production';
  // Security hard-gate: Production builds ALWAYS force __VITE_ENABLE_DEMO_ACCESS__ to false,
  // even if VITE_ENABLE_DEMO_ACCESS=true is set in the environment.
  const enableDemoAccess = !isProduction && process.env.VITE_ENABLE_DEMO_ACCESS === 'true';

  return {
    plugins: [react()],
    define: {
      __VITE_ENABLE_DEMO_ACCESS__: JSON.stringify(enableDemoAccess),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist/client',
    },
    test: {
      hookTimeout: 120000,
      testTimeout: 60000,
    },
  };
});
