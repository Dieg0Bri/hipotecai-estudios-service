/**
 * /api-estudios/catalogos — catálogos legales: tipos de documento,
 * estados de estudio, clientes/mandantes.
 */
const express = require('express');
const databaseService = require('../../services/databaseService');
const router = express.Router();

// Lista del catálogo. Filtros opcionales:
//   ?tipo=base|condicional       — solo base o solo condicionales
//   ?categoria=cbr|estado_civil… — solo de una categoría
router.get('/clasificaciones', async (req, res) => {
  try {
    let data = await databaseService.listClasificaciones();
    if (req.query.tipo) {
      data = data.filter((d) => d.tipo_categoria === req.query.tipo);
    }
    if (req.query.categoria) {
      data = data.filter((d) => d.categoria === req.query.categoria);
    }
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

router.get('/clientes', async (req, res) => {
  try {
    const data = await databaseService.listClientes(req.tenantId);
    res.status(200).json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', code: 'LIST_CLIENTES_FAILED', message: err.message });
  }
});

module.exports = router;
