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

  async listEstudios({ tenantId, estado, search, limit = 50, offset = 0 } = {}) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const where = ['e.eliminado = FALSE'];
    const params = [tenantId];
    where.push(`e.id_tenant = $${params.length}`);

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

  async getEstudioByFolio(folio, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const sql = `
      SELECT e.*, ee.codigo AS estado_codigo, ee.nombre AS estado_nombre,
             c.nombre AS cliente_nombre, c.tipo AS cliente_tipo
      FROM dt_estudio e
      LEFT JOIN dt_estados_estudio ee ON ee.id = e.id_estado
      LEFT JOIN dt_clientes c        ON c.id_cliente = e.id_cliente
      WHERE e.folio = $1 AND e.id_tenant = $2 AND e.eliminado = FALSE
    `;
    const { rows } = await pool.query(sql, [folio, tenantId]);
    return rows[0] || null;
  }

  async createEstudio(data, emailLetrado, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const folio = await this._generateFolio(tenantId);
    const sql = `
      INSERT INTO dt_estudio (
        id_tenant, folio, rol_sii, direccion, comuna, region, encargo, plazo_dias,
        id_cliente, email_letrado, fecha_apertura, fecha_creacion, id_estado
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(),
        (SELECT id FROM dt_estados_estudio WHERE codigo = 'borrador'))
      RETURNING *
    `;
    const params = [
      tenantId,
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

  async updateEstudioStatus(folio, estadoCodigo, emailLetrado, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const sql = `
      UPDATE dt_estudio
      SET id_estado = (SELECT id FROM dt_estados_estudio WHERE codigo = $1),
          fecha_actualizacion = NOW()
      WHERE folio = $2 AND email_letrado = $3 AND id_tenant = $4
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [estadoCodigo, folio, emailLetrado, tenantId]);
    return rows[0];
  }

  // El folio es UNIQUE(id_tenant, folio) — debemos contar por tenant para
  // que cada despacho tenga su propia secuencia EH-YYYY-NNNN sin colisiones
  // y sin "saltar" números porque otro tenant los usó.
  async _generateFolio(tenantId) {
    const year = new Date().getFullYear();
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int + 1 AS next
       FROM dt_estudio
       WHERE id_tenant = $1 AND EXTRACT(YEAR FROM fecha_creacion) = $2`,
      [tenantId, year]
    );
    const next = String(rows[0].next).padStart(4, '0');
    return `EH-${year}-${next}`;
  }

  /* ─────────────────────── ARCHIVOS ─────────────────────── */

  async listArchivos(folio, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const sql = `
      SELECT a.*, cl.codigo AS clasificacion_codigo, cl.nombre AS clasificacion_nombre
      FROM dt_archivos a
      INNER JOIN dt_estudio e        ON e.id_estudio = a.id_estudio
      LEFT JOIN dt_clasificaciones cl ON cl.id = a.id_clasificacion
      WHERE e.folio = $1 AND e.id_tenant = $2 AND a.eliminado = FALSE
      ORDER BY a.fecha_subida DESC
    `;
    const { rows } = await pool.query(sql, [folio, tenantId]);
    return rows;
  }

  // Archivo individual con sus extracciones (para el visor de documento).
  async getArchivoConExtracciones(folio, idArchivo, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const archivoQ = await pool.query(
      `SELECT a.*, cl.codigo AS clasificacion_codigo, cl.nombre AS clasificacion_nombre,
              cl.categoria AS clasificacion_categoria, cl.emisor AS clasificacion_emisor
       FROM dt_archivos a
       INNER JOIN dt_estudio e        ON e.id_estudio = a.id_estudio
       LEFT JOIN dt_clasificaciones cl ON cl.id = a.id_clasificacion
       WHERE e.folio = $1 AND a.id_archivo = $2
         AND e.id_tenant = $3 AND a.eliminado = FALSE`,
      [folio, idArchivo, tenantId]
    );
    if (!archivoQ.rows[0]) return null;
    const extQ = await pool.query(
      `SELECT id_extraccion, schema_codigo, datos, spans, confianza, fecha
       FROM dt_extraccion WHERE id_archivo = $1 AND id_tenant = $2
       ORDER BY fecha DESC`,
      [idArchivo, tenantId]
    );
    return { ...archivoQ.rows[0], extracciones: extQ.rows };
  }

  async registerArchivo({ folio, nombre, gcsPath, mimeType, sizeBytes, sha256, tenantId }) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const sql = `
      INSERT INTO dt_archivos (
        id_tenant, id_estudio, nombre, gcs_path, mime_type, size_bytes, sha256,
        estado_procesamiento, eliminado, fecha_subida
      )
      SELECT id_tenant, id_estudio, $3, $4, $5, $6, $7, 'recibido', FALSE, NOW()
      FROM dt_estudio WHERE folio = $1 AND id_tenant = $2
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [folio, tenantId, nombre, gcsPath, mimeType, sizeBytes, sha256]);
    return rows[0];
  }

  async updateArchivoMetadata(idArchivo, fields, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const allowed = ['id_clasificacion', 'estado_procesamiento', 'estado_revision', 'observacion'];
    const sets = [];
    const params = [];
    for (const key of Object.keys(fields)) {
      if (!allowed.includes(key)) continue;
      params.push(fields[key]);
      sets.push(`${key} = $${params.length}`);
    }
    if (!sets.length) return null;

    // Si el letrado setea id_clasificacion manualmente y el archivo está
    // atascado en un estado pre-clasificación ('recibido' / 'clasificando'),
    // lo promovemos a 'clasificado' automáticamente. Esto destraba archivos
    // que el clasificador no pudo actualizar (ej. Eventarc no llegó a la BBDD).
    const cambiaTipo = fields.id_clasificacion != null;
    const fuerzaEstado = fields.estado_procesamiento != null;
    if (cambiaTipo && !fuerzaEstado) {
      sets.push(
        `estado_procesamiento = CASE WHEN estado_procesamiento IN ('recibido','clasificando') THEN 'clasificado' ELSE estado_procesamiento END`
      );
    }

    params.push(idArchivo);
    params.push(tenantId);
    const sql = `UPDATE dt_archivos SET ${sets.join(', ')}, fecha_actualizacion = NOW()
                 WHERE id_archivo = $${params.length - 1} AND id_tenant = $${params.length}
                 RETURNING *`;
    const { rows } = await pool.query(sql, params);
    return rows[0];
  }

  async softDeleteArchivo(idArchivo, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    await pool.query(
      `UPDATE dt_archivos SET eliminado = TRUE, fecha_actualizacion = NOW()
       WHERE id_archivo = $1 AND id_tenant = $2`,
      [idArchivo, tenantId]
    );
  }

  /* ──────────────────── CATÁLOGOS ──────────────────── */

  async listClasificaciones() {
    const { rows } = await pool.query(
      `SELECT id, codigo, nombre, descripcion, requiere_plano,
              categoria, tipo_categoria, emisor, vigencia_dias, orden
         FROM dt_clasificaciones
        ORDER BY orden`
    );
    return rows;
  }

  /* ──────────────────── PIPELINE DE PROCESAMIENTO ──────────────────── */

  // Devuelve los archivos del estudio listos para extracción:
  // estado_revision='aprobado', estado_procesamiento NO en ('extrayendo','procesado'),
  // y con id_clasificacion seteado.
  async listArchivosListosParaExtraer(folio, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const { rows } = await pool.query(
      `SELECT a.id_archivo, a.nombre, a.gcs_path, cl.codigo AS clasificacion_codigo
       FROM dt_archivos a
       JOIN dt_estudio e        ON e.id_estudio = a.id_estudio
       JOIN dt_clasificaciones cl ON cl.id = a.id_clasificacion
       WHERE e.folio = $1 AND e.id_tenant = $2
         AND a.eliminado = FALSE
         AND a.estado_revision = 'aprobado'
         AND a.estado_procesamiento NOT IN ('extrayendo','procesado')`,
      [folio, tenantId]
    );
    return rows;
  }

  // Devuelve un archivo concreto si existe, está aprobado y tiene clasificación.
  // Usado por el endpoint de reprocesamiento individual.
  async getArchivoParaExtraer(folio, idArchivo, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const { rows } = await pool.query(
      `SELECT a.id_archivo, a.nombre, a.gcs_path, cl.codigo AS clasificacion_codigo
       FROM dt_archivos a
       JOIN dt_estudio e        ON e.id_estudio = a.id_estudio
       JOIN dt_clasificaciones cl ON cl.id = a.id_clasificacion
       WHERE e.folio = $1 AND e.id_tenant = $3
         AND a.id_archivo = $2
         AND a.eliminado = FALSE
         AND a.estado_revision = 'aprobado'`,
      [folio, idArchivo, tenantId]
    );
    return rows[0] || null;
  }

  // Marca un archivo como 'extrayendo'. Permite reprocesar archivos en estado
  // 'procesado' o 'error' — solo bloquea si ya está corriendo (otra ejecución
  // en paralelo). Defense-in-depth: filtra por tenant aunque el caller ya
  // resolvió el archivo vía getArchivoParaExtraer.
  async markArchivoExtrayendo(idArchivo, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    await pool.query(
      `UPDATE dt_archivos SET estado_procesamiento='extrayendo', fecha_actualizacion=NOW()
       WHERE id_archivo=$1 AND id_tenant=$2 AND estado_procesamiento != 'extrayendo'`,
      [idArchivo, tenantId]
    );
  }

  async markArchivoProcesado(idArchivo, ok = true, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    await pool.query(
      `UPDATE dt_archivos SET estado_procesamiento=$2, fecha_actualizacion=NOW()
       WHERE id_archivo=$1 AND id_tenant=$3`,
      [idArchivo, ok ? 'procesado' : 'error', tenantId]
    );
  }

  // Recovery: archivos en 'extrayendo' por más de N minutos se asumen como
  // huérfanos (la instancia que los procesaba murió). Los marcamos 'error'
  // para que el letrado pueda reintentarlos manualmente.
  // tenantId es OBLIGATORIO: el letrado solo puede destrabar archivos de su
  // propio tenant. El sweep cross-tenant queda como tarea de mantenimiento
  // operacional (job cron con SA elevado), no expuesto via HTTP.
  async resetArchivosAtascados(folio, minutos = 15, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const interval = `${parseInt(minutos, 10) || 15} minutes`;
    if (folio) {
      const { rowCount } = await pool.query(
        `UPDATE dt_archivos a
         SET estado_procesamiento = 'error',
             observacion = COALESCE(a.observacion, '') || ' [recovery: instancia caída]',
             fecha_actualizacion = NOW()
         FROM dt_estudio e
         WHERE e.id_estudio = a.id_estudio
           AND e.folio = $1
           AND e.id_tenant = $2
           AND a.estado_procesamiento = 'extrayendo'
           AND a.fecha_actualizacion < NOW() - INTERVAL '${interval}'`,
        [folio, tenantId]
      );
      return rowCount;
    }
    const { rowCount } = await pool.query(
      `UPDATE dt_archivos
       SET estado_procesamiento = 'error',
           observacion = COALESCE(observacion, '') || ' [recovery: instancia caída]',
           fecha_actualizacion = NOW()
       WHERE id_tenant = $1
         AND estado_procesamiento = 'extrayendo'
         AND fecha_actualizacion < NOW() - INTERVAL '${interval}'`,
      [tenantId]
    );
    return rowCount;
  }

  // Recovery operacional cross-tenant — SOLO para uso del loader al
  // arrancar la instancia. NO exponer via HTTP. La razón de ser un método
  // separado es que `resetArchivosAtascados` (con tenant) garantiza que
  // ningún path HTTP pueda accidentalmente barrer estudios de otros
  // despachos. Aquí es system-scoped y por eso lleva sufijo explícito.
  async resetArchivosAtascadosSystemWide(minutos = 15) {
    const interval = `${parseInt(minutos, 10) || 15} minutes`;
    const { rowCount } = await pool.query(
      `UPDATE dt_archivos
       SET estado_procesamiento = 'error',
           observacion = COALESCE(observacion, '') || ' [recovery: instancia caída]',
           fecha_actualizacion = NOW()
       WHERE estado_procesamiento = 'extrayendo'
         AND fecha_actualizacion < NOW() - INTERVAL '${interval}'`
    );
    return rowCount;
  }

  // Para chequeos de "todos están aprobados" antes de habilitar el botón.
  async getArchivosRevisionStats(folio, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE a.eliminado = FALSE)                          AS total,
         COUNT(*) FILTER (WHERE a.eliminado = FALSE AND a.estado_revision = 'aprobado')   AS aprobados,
         COUNT(*) FILTER (WHERE a.eliminado = FALSE AND a.estado_revision = 'pendiente')  AS pendientes,
         COUNT(*) FILTER (WHERE a.eliminado = FALSE AND a.estado_revision = 'observado')  AS observados,
         COUNT(*) FILTER (WHERE a.eliminado = FALSE AND a.estado_revision = 'rechazado')  AS rechazados
       FROM dt_archivos a
       JOIN dt_estudio e ON e.id_estudio = a.id_estudio
       WHERE e.folio = $1 AND e.id_tenant = $2`,
      [folio, tenantId]
    );
    return rows[0] || { total: 0, aprobados: 0, pendientes: 0, observados: 0, rechazados: 0 };
  }

  /* ──────────────────── DOCUMENTOS SOLICITADOS ──────────────────── */

  async listDocumentosSolicitados(folio, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const { rows } = await pool.query(
      `SELECT
         ds.id_solicitud,
         ds.trigger_id,
         ds.motivo,
         ds.matched_phrase,
         ds.estado,
         ds.fecha_creacion,
         ds.fecha_resolucion,
         c.codigo            AS codigo_solicitado,
         c.nombre            AS nombre_solicitado,
         c.categoria,
         c.emisor,
         a_origen.id_archivo AS id_archivo_origen,
         a_origen.nombre     AS nombre_archivo_origen,
         a_resuelto.id_archivo AS id_archivo_resuelto,
         a_resuelto.nombre   AS nombre_archivo_resuelto
       FROM dt_documentos_solicitados ds
       JOIN dt_estudio e          ON e.id_estudio = ds.id_estudio
       JOIN dt_clasificaciones c  ON c.id = ds.id_clasificacion
       LEFT JOIN dt_archivos a_origen   ON a_origen.id_archivo = ds.id_archivo_origen
       LEFT JOIN dt_archivos a_resuelto ON a_resuelto.id_archivo = ds.id_archivo_resuelto
       WHERE e.folio = $1 AND e.id_tenant = $2
       ORDER BY ds.fecha_creacion DESC`,
      [folio, tenantId]
    );
    return rows;
  }

  async updateSolicitudEstado(idSolicitud, estado, idArchivoResuelto = null, tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const { rows } = await pool.query(
      `UPDATE dt_documentos_solicitados
          SET estado = $2,
              id_archivo_resuelto = $3,
              fecha_resolucion = CASE WHEN $2 IN ('subido','descartado') THEN NOW() ELSE NULL END
        WHERE id_solicitud = $1 AND id_tenant = $4
        RETURNING *`,
      [idSolicitud, estado, idArchivoResuelto, tenantId]
    );
    return rows[0] || null;
  }

  // dt_estados_estudio es catálogo global — sin tenant.
  async listEstados() {
    const { rows } = await pool.query(
      'SELECT id, codigo, nombre FROM dt_estados_estudio ORDER BY orden'
    );
    return rows;
  }

  // dt_clientes ahora es por tenant — cada despacho ve sus propios mandantes.
  async listClientes(tenantId) {
    if (tenantId == null) throw new Error('tenantId es requerido');
    const { rows } = await pool.query(
      `SELECT id_cliente, nombre, rut, tipo
       FROM dt_clientes
       WHERE id_tenant = $1 AND eliminado = FALSE
       ORDER BY nombre`,
      [tenantId]
    );
    return rows;
  }

  /* ──────────────────── AUTORIZACIÓN ──────────────────── */

  /** Lookup mínimo para validar tenant antes de firmar URLs. */
  async findArchivoByGcsPath(gcsPath) {
    const { rows } = await pool.query(
      `SELECT id_archivo, id_estudio, id_tenant, eliminado
       FROM dt_archivos WHERE gcs_path = $1`,
      [gcsPath]
    );
    return rows[0] || null;
  }

  /* ──────────────────── HASH UTIL ──────────────────── */

  hashForAnalytics(value) {
    if (!value) return undefined;
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
  }
}

module.exports = new DatabaseService();
