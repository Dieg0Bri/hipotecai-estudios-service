const express = require('express');
const router = express.Router();
const { pool } = require('../../config/database');

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT NOW() AS now');
    res.status(200).json({
      status: 'success',
      data: { service: 'estudios-service', database: 'ok', now: rows[0].now },
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      code: 'DB_UNAVAILABLE',
      data: { service: 'estudios-service', database: 'error', error: err.message },
    });
  }
});

module.exports = router;
