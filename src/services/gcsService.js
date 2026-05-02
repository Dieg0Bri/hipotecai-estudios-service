/**
 * gcsService · interacción con Cloud Storage
 * --------------------------------------------------------------
 * Sólo emite URLs firmadas para descargar documentos. La subida
 * la hace ingestion-service.
 */
const { Storage } = require('@google-cloud/storage');
const config = require('../../config');
const loggingService = require('./loggingService');

let storage;
try {
  storage = new Storage();
} catch (err) {
  loggingService.warn('GCS Storage init failed (esperable en local sin ADC)', { error: err.message });
}

async function generateSignedUrl(gcsPath, action = 'read', minutes = config.gcsSignedUrlExpirationMinutes) {
  if (!storage) throw new Error('GCS no inicializado. Configura credenciales (gcloud auth application-default login).');

  const bucketName = config.gcsBucketDocumentos;
  const file = storage.bucket(bucketName).file(gcsPath);

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action,
    expires: Date.now() + minutes * 60 * 1000,
  });

  return { url, expiresIn: minutes * 60 };
}

module.exports = { generateSignedUrl };
