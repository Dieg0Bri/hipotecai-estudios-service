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

// Archivo individual + sus extracciones (para el visor)
router.get('/:folio/archivos/:fileId', async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId, 10);
    const archivo = await databaseService.getArchivoConExtracciones(req.params.folio, fileId);
    if (!archivo) {
      return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Archivo no encontrado en este expediente.' });
    }
    res.status(200).json({ status: 'success', data: archivo });
  } catch (err) {
    loggingService.error('Error fetching archivo', { fileId: req.params.fileId, error: err.message });
    res.status(500).json({ status: 'error', code: 'FETCH_FILE_FAILED', message: err.message });
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

// Stats de revisión humana de las clasificaciones (usado por la UI para
// habilitar/deshabilitar el botón "Procesar todo").
router.get('/:folio/revision-stats', async (req, res) => {
  try {
    const stats = await databaseService.getArchivosRevisionStats(req.params.folio);
    const total = parseInt(stats.total, 10) || 0;
    const aprobados = parseInt(stats.aprobados, 10) || 0;
    const procesable = total > 0 && aprobados === total;
    res.status(200).json({
      status: 'success',
      data: { ...stats, total, aprobados, procesable },
    });
  } catch (err) {
    loggingService.error('revision-stats failed', { error: err.message });
    res.status(500).json({ status: 'error', code: 'STATS_FAILED', message: err.message });
  }
});

// Helper de concurrencia limitada (sin dependencias). Procesa items con
// `mapper` paralelizando `concurrency` workers a la vez. Resultados en orden.
async function pMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Helper compartido: procesa un archivo llamando a documentos-api/extract-from-gcs.
// Marca estado en BBDD (extrayendo → procesado/error). Devuelve resumen.
async function procesarArchivo(req, archivo, folio) {
  const config = require('../../../config');
  await databaseService.markArchivoExtrayendo(archivo.id_archivo);
  const url = `${config.documentosApiUrl.replace(/\/$/, '')}/extract-from-gcs`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.documentosApiTimeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      },
      body: JSON.stringify({
        tipo: archivo.clasificacion_codigo,
        folio,
        gcs_path: archivo.gcs_path,
        id_archivo: archivo.id_archivo,
      }),
      signal: ctrl.signal,
    });
    const ok = resp.ok;
    await databaseService.markArchivoProcesado(archivo.id_archivo, ok);
    return { id_archivo: archivo.id_archivo, nombre: archivo.nombre, ok, status: resp.status };
  } catch (e) {
    await databaseService.markArchivoProcesado(archivo.id_archivo, false);
    return { id_archivo: archivo.id_archivo, nombre: archivo.nombre, ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

// "Procesar todo el expediente" (síncrono).
//
// Para flujos típicos el FRONTEND prefiere iterar archivo por archivo via
// POST /:folio/archivos/:fileId/procesar — esto da progreso en vivo y evita
// el timeout de Cloud Run con muchos archivos.
//
// Este endpoint queda como atajo para llamadas directas (CLI, testing) con
// pocos archivos. Si excede el timeout default de Cloud Run, falla parcial:
// la BBDD persiste el progreso, los pendientes quedan 'aprobado' para reintentar.
router.post('/:folio/procesar', async (req, res) => {
  const folio = req.params.folio;
  try {
    const stats = await databaseService.getArchivosRevisionStats(folio);
    const total = parseInt(stats.total, 10) || 0;
    const aprobados = parseInt(stats.aprobados, 10) || 0;
    if (total === 0) {
      return res.status(400).json({ status: 'error', code: 'SIN_ARCHIVOS', message: 'El estudio no tiene archivos.' });
    }
    if (aprobados !== total) {
      return res.status(400).json({
        status: 'error',
        code: 'REVISION_INCOMPLETA',
        message: `Hay ${total - aprobados} archivo(s) sin aprobar. Revísalos antes de procesar.`,
      });
    }

    const config = require('../../../config');
    if (!config.documentosApiUrl) {
      return res.status(500).json({
        status: 'error',
        code: 'DOCAPI_NO_CONFIGURADO',
        message: 'DOCUMENTOS_API_URL no configurada en estudios-service.',
      });
    }

    const archivos = await databaseService.listArchivosListosParaExtraer(folio);
    // Paralelo con concurrencia 5: 27 archivos × 30s ≈ 3 min total (en serie
    // serían 13.5 min y excederían el timeout de Cloud Run). Si Gemini empieza
    // a rate-limitar, bajar a 3.
    const resultados = await pMap(archivos, (a) => procesarArchivo(req, a, folio), 5);
    const exitosos = resultados.filter((r) => r.ok).length;
    res.status(200).json({
      status: 'success',
      data: { folio, total: resultados.length, exitosos, fallidos: resultados.length - exitosos, resultados },
    });
  } catch (err) {
    loggingService.error('procesar estudio failed', { folio, error: err.message });
    res.status(500).json({ status: 'error', code: 'PROCESAR_FAILED', message: err.message });
  }
});

// Limpieza manual: archivos atascados en 'extrayendo' por más de N minutos
// (default 15) se marcan como 'error' para que el letrado pueda reintentarlos.
// Se llama automáticamente al arrancar la instancia (loaders/index.js) y a mano.
router.post('/:folio/limpiar-extrayendo', async (req, res) => {
  try {
    const minutos = parseInt(req.query.minutos, 10) || 15;
    const limpiados = await databaseService.resetArchivosAtascados(req.params.folio, minutos);
    res.status(200).json({ status: 'success', data: { folio: req.params.folio, limpiados, minutos } });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 'LIMPIAR_FAILED', message: err.message });
  }
});

// Reprocesar UN archivo (útil cuando una extracción falló o se quiere re-correr
// después de cambiar el tipo). Permite re-procesar incluso si ya está en 'procesado'.
router.post('/:folio/archivos/:fileId/procesar', async (req, res) => {
  const folio = req.params.folio;
  const fileId = parseInt(req.params.fileId, 10);
  try {
    const config = require('../../../config');
    if (!config.documentosApiUrl) {
      return res.status(500).json({
        status: 'error',
        code: 'DOCAPI_NO_CONFIGURADO',
        message: 'DOCUMENTOS_API_URL no configurada en estudios-service.',
      });
    }

    const a = await databaseService.getArchivoParaExtraer(folio, fileId);
    if (!a) {
      return res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Archivo no encontrado, o sin clasificación, o sin aprobación humana.',
      });
    }

    const resultado = await procesarArchivo(req, a, folio);
    res.status(200).json({ status: 'success', data: resultado });
  } catch (err) {
    loggingService.error('reprocesar archivo failed', { folio, fileId, error: err.message });
    res.status(500).json({ status: 'error', code: 'REPROCESAR_FAILED', message: err.message });
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
