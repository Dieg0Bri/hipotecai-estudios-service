/**
 * Analytics middleware — un log estructurado JSON por request.
 * Inspirado en proyects-service de ISA1.
 */
const loggingService = require('../services/loggingService');

function analyticsMiddleware() {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      loggingService.info('http_request', {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration_ms: Date.now() - start,
        userEmail: req.user?.email,
        requestId: req.requestId,
      });
    });
    next();
  };
}

module.exports = { analyticsMiddleware };
