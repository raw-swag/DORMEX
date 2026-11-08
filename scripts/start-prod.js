#!/usr/bin/env node
/**
 * DORMEX Production Server Runner
 *
 * Ensures NODE_ENV=production and HOST=0.0.0.0 are strictly enforced for production execution (e.g. Render).
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
if (process.env.NODE_ENV === 'production') {
  process.env.HOST = process.env.HOST || '0.0.0.0';
}

import('../dist/server.js');
