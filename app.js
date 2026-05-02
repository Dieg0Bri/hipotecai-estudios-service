const express = require('express');
const config = require('./config');
const loaders = require('./src/loaders');
const { testConnection } = require('./src/config/database');
const loggingService = require('./src/services/loggingService');

async function startServer() {
  const app = express();
  await testConnection();
  await loaders(app);

  app.listen(config.port, '0.0.0.0', () => {
    loggingService.info('estudios-service started', {
      port: config.port,
      environment: config.environment,
      timestamp: new Date().toISOString(),
    });
  }).on('error', (err) => {
    loggingService.error('Failed to start estudios-service', { error: err.message });
    process.exit(1);
  });
}

startServer();
