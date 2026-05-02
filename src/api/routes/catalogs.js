/**
 * /api-estudios/catalogos — catálogos legales: tipos de documento,
 * estados de estudio, clientes/mandantes.
 */
const express = require('express');
const databaseService = require('../../services/databaseService');
const router = express.Router();

router.get('/clasificaciones', async (_req, res) => {
  try {
    const data = await databaseService.listClasificaciones();
    res.status(200).json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 'LIST_CLAS_FAILED', message: err.message });
  }
});

router.get('/estados', async (_req, res) => {
  try {
    const data = await databaseService.listEstados();
    res.status(200).json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 'LIST_ESTADOS_FAILED', message: err.message });
  }
});

router.get('/clientes', async (_req, res) => {
  try {
    const data = await databaseService.listClientes();
    res.status(200).json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 'LIST_CLIENTES_FAILED', message: err.message });
  }
});

module.exports = router;
