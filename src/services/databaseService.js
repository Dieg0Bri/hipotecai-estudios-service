/**
 * databaseService · acceso SQL al esquema dt_*
 * --------------------------------------------------------------
 * Tablas relevantes (ver migrations/001_init.sql):
 *   dt_estudio                — encabezado del estudio hipotecario
 *   dt_archivos               — documentos subidos
 *   dt_clasificaciones        — catálogo de tipos de documento legal
 *   dt_estados_estudio        — catálogo de estados (borrador, en_analisis, …)
 *   dt_clientes               — clientes/mandantes
 *   dt_usuarios               — letrados con sesión activa
 *   dt_extraccion             — extracciones JSONB por archivo
 *   dt_sintetizador           — síntesis versionada por estudio
 *   dt_hallazgos              — hallazgos de la verificación legal
 */
const crypto = require('crypto');
const { pool } = require('../config/database');
const loggingService = require('./loggingService');

class DatabaseService {
  /* ─────────────────────── ESTUDIOS ─────────────────────── */

  async listEstudios({ estado, search, limit = 50, offset = 0 } = {}) {
    const where = ['e.eliminado = FALSE'];
    const params = [];

    if (estado) {
      params.push(estado);
      where.push(`ee.codigo = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where.push(`(LOWER(e.folio) LIKE $${params.length}
         OR LOWER(e.rol_sii) LIKE $${params.length}
         OR LOWER(e.direccion) LIKE $${params.length}
         OR LOWER(c.nombre) LIKE $${params.length})`);
    }
    params.push(limit, offset);

    const sql = `
      SELECT
        e.id_estudio,
        e.folio,
        e.rol_sii,
        e.direccion,
        e.comuna,
        e.region,
        e.encargo,
        e.plazo_dias,
        e.fecha_apertura,
        e.fecha_creacion,
        e.email_letrado,
        ee.codigo       AS estado_codigo,
        ee.nombre       AS estado_nombre,
        c.id_cliente,
        c.nombre        AS cliente_nombre,
        COUNT(a.id_archivo) FILTER (WHERE a.eliminado = FALSE)::int AS num_documentos,
        ROUND(AVG(CASE WHEN a.estado_procesamiento = 'procesado' THEN 100
                       WHEN a.estado_procesamiento = 'extrayendo' THEN 50
                       WHEN a.estado_procesamiento = 'clasificado' THEN 30
                       ELSE 0 END))::int AS avance_pct
      FROM dt_estudio e
      LEFT JOIN dt_estados_estudio ee ON ee.id = e.id_estado
      LEFT JOIN dt_clientes c        ON c.id_cliente = e.id_cliente
      LEFT JOIN dt_archivos a        ON a.id_estudio = e.id_estudio AND a.eliminado = FALSE
      WHERE ${where.join(' AND ')}
      GROUP BY e.id_estudio, ee.codigo, ee.nombre, c.id_cliente, c.nombre
      ORDER BY e.fecha_creacion DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const { rows } = await pool.query(sql, params);
    return rows;
  }

  async getEstudioByFolio(folio) {
    const sql = `
      SELECT e.*, ee.codigo AS estado_codigo, ee.nombre AS estado_nombre,
             c.nombre AS cliente_nombre, c.tipo AS cliente_tipo
      FROM dt_estudio e
      LEFT JOIN dt_estados_estudio ee ON ee.id = e.id_estado
      LEFT JOIN dt_clientes c        ON c.id_cliente = e.id_cliente
      WHERE e.folio = $1 AND e.eliminado = FALSE
    `;
    const { rows } = await pool.query(sql, [folio]);
    return rows[0] || null;
  }

  async createEstudio(data, emailLetrado) {
    const folio = await this._generateFolio();
    const sql = `
      INSERT INTO dt_estudio (
        folio, rol_sii, direccion, comuna, region, encargo, plazo_dias,
        id_cliente, email_letrado, fecha_apertura, fecha_creacion, id_estado
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(),
        (SELECT id FROM dt_estados_estudio WHERE codigo = 'borrador'))
      RETURNING *
    `;
    const params = [
      folio,
      data.rol_sii,
      data.direccion,
      data.comuna,
      data.region || 'Metropolitana',
      data.encargo || null,
      data.plazo_dias || 7,
      data.id_cliente || null,
      emailLetrado,
    ];
    const { rows } = await pool.query(sql, params);
    return rows[0];
  }

  async updateEstudioStatus(folio, estadoCodigo, emailLetrado) {
    const sql = `
      UPDATE dt_estudio
      SET id_estado = (SELECT id FROM dt_estados_estudio WHERE codigo = $1),
          fecha_actualizacion = NOW()
      WHERE folio = $2 AND email_letrado = $3
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [estadoCodigo, folio, emailLetrado]);
    return rows[0];
  }

  async _generateFolio() {
    const year = new Date().getFullYear();
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int + 1 AS next FROM dt_estudio WHERE EXTRACT(YEAR FROM fecha_creacion) = $1`,
      [year]
    );
    const next = String(rows[0].next).padStart(4, '0');
    return `EH-${year}-${next}`;
  }

  /* ─────────────────────── ARCHIVOS ─────────────────────── */

  async listArchivos(folio) {
    const sql = `
      SELECT a.*, cl.codigo AS clasificacion_codigo, cl.nombre AS clasificacion_nombre
      FROM dt_archivos a
      INNER JOIN dt_estudio e        ON e.id_estudio = a.id_estudio
      LEFT JOIN dt_clasificaciones cl ON cl.id = a.id_clasificacion
      WHERE e.folio = $1 AND a.eliminado = FALSE
      ORDER BY a.fecha_subida DESC
    `;
    const { rows } = await pool.query(sql, [folio]);
    return rows;
  }

  async registerArchivo({ folio, nombre, gcsPath, mimeType, sizeBytes, sha256 }) {
    const sql = `
      INSERT INTO dt_archivos (
        id_estudio, nombre, gcs_path, mime_type, size_bytes, sha256,
        estado_procesamiento, eliminado, fecha_subida
      )
      SELECT id_estudio, $2, $3, $4, $5, $6, 'recibido', FALSE, NOW()
      FROM dt_estudio WHERE folio = $1
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [folio, nombre, gcsPath, mimeType, sizeBytes, sha256]);
    return rows[0];
  }

  async updateArchivoMetadata(idArchivo, fields) {
    const allowed = ['id_clasificacion', 'estado_procesamiento', 'estado_revision', 'observacion'];
    const sets = [];
    const params = [];
    for (const key of Object.keys(fields)) {
      if (!allowed.includes(key)) continue;
      params.push(fields[key]);
      sets.push(`${key} = $${params.length}`);
    }
    if (!sets.length) return null;
    params.push(idArchivo);
    const sql = `UPDATE dt_archivos SET ${sets.join(', ')}, fecha_actualizacion = NOW() WHERE id_archivo = $${params.length} RETURNING *`;
    const { rows } = await pool.query(sql, params);
    return rows[0];
  }

  async softDeleteArchivo(idArchivo) {
    await pool.query(
      `UPDATE dt_archivos SET eliminado = TRUE, fecha_actualizacion = NOW() WHERE id_archivo = $1`,
      [idArchivo]
    );
  }

  /* ──────────────────── CATÁLOGOS ──────────────────── */

  async listClasificaciones() {
    const { rows } = await pool.query(
      'SELECT id, codigo, nombre, descripcion, requiere_plano FROM dt_clasificaciones ORDER BY orden'
    );
    return rows;
  }

  async listEstados() {
    const { rows } = await pool.query(
      'SELECT id, codigo, nombre FROM dt_estados_estudio ORDER BY orden'
    );
    return rows;
  }

  async listClientes() {
    const { rows } = await pool.query(
      'SELECT id_cliente, nombre, rut, tipo FROM dt_clientes WHERE eliminado = FALSE ORDER BY nombre'
    );
    return rows;
  }

  /* ──────────────────── HASH UTIL ──────────────────── */

  hashForAnalytics(value) {
    if (!value) return undefined;
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
  }
}

module.exports = new DatabaseService();
