const expressLoader = require('./express');
const databaseService = require('../services/databaseService');
const loggingService = require('../services/loggingService');

module.exports = async (app) => {
  expressLoader(app);

  // Recovery al arrancar la instancia: si dejó archivos atascados en
  // 'extrayendo' (porque la instancia anterior crasheó o fue terminada
  // por Cloud Run), los marcamos 'error' para que el letrado pueda
  // reintentarlos manualmente. Idempotente.
  try {
    const limpiados = await databaseService.resetArchivosAtascadosSystemWide(15);
    if (limpiados > 0) {
      loggingService.info('Recovery startup: archivos atascados marcados error', { count: limpiados });
    }
  } catch (err) {
    loggingService.error('Recovery startup falló (no bloqueante)', { error: err.message });
  }
};
