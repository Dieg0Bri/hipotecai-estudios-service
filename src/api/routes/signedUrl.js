/**
 * /api-estudios/signed-url?gcs_path=...
 * Devuelve una URL firmada V4 (15 min por defecto) para descargar
 * un documento del bucket de hipotecai.
 *
 * SEGURIDAD: validamos que el archivo pertenezca al tenant del usuario
 * autenticado antes de firmar — sin esto, conocer el `gcs_path` permitía
 * descargar documentos de otro despacho.
 */
const express = require('express');
const gcsService = require('../../services/gcsService');
const databaseService = require('../../services/databaseService');
const loggingService = require('../../services/loggingService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const gcsPath = req.query.gcs_path || req.query.path;
    if (!gcsPath) {
      return res.status(400).json({ status: 'error', code: 'MISSING_PATH', message: 'gcs_path requerido' });
    }

    const archivo = await databaseService.findArchivoByGcsPath(String(gcsPath));
    if (!archivo || archivo.eliminado || archivo.id_tenant !== req.tenantId) {
      return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Archivo no encontrado.' });
    }

    const { url, expiresIn } = await gcsService.generateSignedUrl(gcsPath, 'read');
    res.status(200).json({ status: 'success', data: { url, expires_in: expiresIn } });
  } catch (err) {
    loggingService.error('Signed URL error', { error: err.message });
    res.status(500).json({ status: 'error', code: 'SIGN_URL_FAILED', message: err.message });
  }
});

module.exports = router;
