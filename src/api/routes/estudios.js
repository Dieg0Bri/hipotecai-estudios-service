/**
 * /api-estudios/estudios — CRUD de estudios hipotecarios.
 *
 *  GET    /api-estudios/estudios              ← listado con filtros (estado, search)
 *  GET    /api-estudios/estudios/:folio       ← detalle del estudio
 *  POST   /api-estudios/estudios              ← apertura de expediente
 *  PUT    /api-estudios/estudios/:folio/status← cambio de estado
 *  GET    /api-estudios/estudios/:folio/archivos ← lista archivos del estudio
 *  PATCH  /api-estudios/estudios/:folio/archivos/:fileId ← actualiza metadatos
 *  DELETE /api-estudios/estudios/:folio/archivos/:fileId ← soft delete
 */
const express = require('express');
const databaseService = require('../../services/databaseService');
const loggingService = require('../../services/loggingService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { estado, search, limit, offset } = req.query;
    const estudios = await databaseService.listEstudios({
      estado,
      search,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.status(200).json({ status: 'success', data: estudios, count: estudios.length });
  } catch (err) {
    loggingService.error('Error listing estudios', { error: err.message });
    res.status(500).json({ status: 'error', code: 'LIST_FAILED', message: err.message });
  }
});

router.get('/:folio', async (req, res) => {
  try {
    const estudio = await databaseService.getEstudioByFolio(req.params.folio);
    if (!estudio) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Estudio no encontrado.' });
    res.status(200).json({ status: 'success', data: estudio });
  } catch (err) {
    loggingService.error('Error fetching estudio', { folio: req.params.folio, error: err.message });
    res.status(500).json({ status: 'error', code: 'FETCH_FAILED', message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const required = ['rol_sii', 'direccion', 'comuna'];
    for (const field of required) {
      if (!req.body[field]) {
        return res.status(400).json({ status: 'error', code: 'MISSING_FIELD', message: `Falta ${field}` });
      }
    }
    const estudio = await databaseService.createEstudio(req.body, req.user.email);
    loggingService.info('Estudio creado', { folio: estudio.folio, letrado: req.user.email });
    res.status(201).json({ status: 'success', data: estudio, message: 'Expediente abierto.' });
  } catch (err) {
    loggingService.error('Error creating estudio', { error: err.message });
    res.status(500).json({ status: 'error', code: 'CREATE_FAILED', message: err.message });
  }
});

router.put('/:folio/status', async (req, res) => {
  try {
    const { estado } = req.body;
    if (!estado) return res.status(400).json({ status: 'error', code: 'MISSING_ESTADO', message: 'estado requerido' });
    const updated = await databaseService.updateEstudioStatus(req.params.folio, estado, req.user.email);
    if (!updated) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Estudio no encontrado o sin permiso.' });
    res.status(200).json({ status: 'success', data: updated });
  } catch (err) {
    loggingService.error('Error updating estudio status', { error: err.message });
    res.status(500).json({ status: 'error', code: 'UPDATE_FAILED', message: err.message });
  }
});

router.get('/:folio/archivos', async (req, res) => {
  try {
    const archivos = await databaseService.listArchivos(req.params.folio);
    res.status(200).json({ status: 'success', data: archivos, count: archivos.length });
  } catch (err) {
    loggingService.error('Error listing archivos', { folio: req.params.folio, error: err.message });
    res.status(500).json({ status: 'error', code: 'LIST_FILES_FAILED', message: err.message });
  }
});

router.patch('/:folio/archivos/:fileId', async (req, res) => {
  try {
    const updated = await databaseService.updateArchivoMetadata(req.params.fileId, req.body);
    if (!updated) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Archivo no encontrado.' });
    res.status(200).json({ status: 'success', data: updated });
  } catch (err) {
    loggingService.error('Error updating archivo', { error: err.message });
    res.status(500).json({ status: 'error', code: 'UPDATE_FILE_FAILED', message: err.message });
  }
});

router.delete('/:folio/archivos/:fileId', async (req, res) => {
  try {
    await databaseService.softDeleteArchivo(req.params.fileId);
    res.status(200).json({ status: 'success', message: 'Archivo eliminado.' });
  } catch (err) {
    loggingService.error('Error deleting archivo', { error: err.message });
    res.status(500).json({ status: 'error', code: 'DELETE_FILE_FAILED', message: err.message });
  }
});

// Documentos que el sistema le solicitó al cliente (gatillados por triggers IF/THEN
// del clasificador). UI los muestra como "te falta subir X por la condición Y".
router.get('/:folio/documentos-solicitados', async (req, res) => {
  try {
    const data = await databaseService.listDocumentosSolicitados(req.params.folio);
    res.status(200).json({ status: 'success', data, count: data.length });
  } catch (err) {
    loggingService.error('Error listing documentos solicitados', {
      folio: req.params.folio, error: err.message,
    });
    res.status(500).json({ status: 'error', code: 'LIST_SOLICITADOS_FAILED', message: err.message });
  }
});

router.patch('/:folio/documentos-solicitados/:idSolicitud', async (req, res) => {
  try {
    const { estado, id_archivo_resuelto } = req.body;
    if (!['pendiente', 'subido', 'descartado'].includes(estado)) {
      return res.status(400).json({ status: 'error', code: 'BAD_ESTADO', message: 'estado inválido' });
    }
    const updated = await databaseService.updateSolicitudEstado(
      req.params.idSolicitud, estado, id_archivo_resuelto || null,
    );
    if (!updated) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Solicitud no encontrada' });
    res.status(200).json({ status: 'success', data: updated });
  } catch (err) {
    loggingService.error('Error updating solicitud', { error: err.message });
    res.status(500).json({ status: 'error', code: 'UPDATE_SOLICITUD_FAILED', message: err.message });
  }
});

module.exports = router;
