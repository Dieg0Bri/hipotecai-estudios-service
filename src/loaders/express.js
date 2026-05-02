/**
 * Express loader · CORS, middlewares, rutas
 */
const express = require('express');
const cors = require('cors');
const { verifyGoogleOAuth } = require('../middleware/auth');
const { analyticsMiddleware } = require('../middleware/analytics');
const loggingService = require('../services/loggingService');
const config = require('../../config');

const healthRoutes = require('../api/routes/health');
const estudiosRoutes = require('../api/routes/estudios');
const catalogsRoutes = require('../api/routes/catalogs');
const signedUrlRoutes = require('../api/routes/signedUrl');

module.exports = (app) => {
  app.use(loggingService.requestLogger());
  app.use(analyticsMiddleware());

  const corsOptions = process.env.NODE_ENV === 'test' ? { origin: '*' } : {
    origin: (origin, cb) => {
      if (!origin || config.allowedOrigins.includes(origin)) return cb(null, true);
      loggingService.warn('CORS rejected', { origin });
      return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  };

  app.use(cors(corsOptions));
  app.use(express.json({ limit: '2mb' }));

  // Pública
  app.use('/api-estudios/health', healthRoutes);

  // Autenticadas
  app.use('/api-estudios/catalogos', verifyGoogleOAuth, catalogsRoutes);
  app.use('/api-estudios/estudios', verifyGoogleOAuth, estudiosRoutes);
  app.use('/api-estudios/signed-url', verifyGoogleOAuth, signedUrlRoutes);

  app.use(loggingService.errorLogger());

  loggingService.info('estudios-service routes registered', {
    endpoints: [
      'GET    /api-estudios/health',
      'GET    /api-estudios/catalogos/{clasificaciones,estados,clientes}',
      'GET    /api-estudios/estudios?estado=&search=',
      'GET    /api-estudios/estudios/:folio',
      'POST   /api-estudios/estudios',
      'PUT    /api-estudios/estudios/:folio/status',
      'GET    /api-estudios/estudios/:folio/archivos',
      'PATCH  /api-estudios/estudios/:folio/archivos/:fileId',
      'DELETE /api-estudios/estudios/:folio/archivos/:fileId',
      'GET    /api-estudios/signed-url?gcs_path=',
    ],
  });
};
