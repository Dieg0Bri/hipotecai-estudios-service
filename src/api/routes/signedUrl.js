/**
 * /api-estudios/signed-url?gcs_path=...
 * Devuelve una URL firmada V4 (15 min por defecto) para descargar
 * un documento del bucket de hipotecai.
 */
const express = require('express');
const gcsService = require('../../services/gcsService');
const loggingService = require('../../services/loggingService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const gcsPath = req.query.gcs_path || req.query.path;
    if (!gcsPath) {
      return res.status(400).json({ status: 'error', code: 'MISSING_PATH', message: 'gcs_path requerido' });
    }
    const { url, expiresIn } = await gcsService.generateSignedUrl(gcsPath, 'read');
    res.status(200).json({ status: 'success', data: { url, expires_in: expiresIn } });
  } catch (err) {
    loggingService.error('Signed URL error', { error: err.message });
    res.status(500).json({ status: 'error', code: 'SIGN_URL_FAILED', message: err.message });
  }
});

module.exports = router;
