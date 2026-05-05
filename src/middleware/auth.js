/**
 * Middleware OAuth gateway-aware — verifica X-Apigateway-Api-Userinfo,
 * cae a verificación directa con google-auth-library en local.
 */
const { OAuth2Client } = require('google-auth-library');
const config = require('../../config');
const loggingService = require('../services/loggingService');
const { resolveTenantId, DEFAULT_TENANT_ID } = require('../services/tenantService');

const client = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

const TEST_USER = {
  email: 'test@hipotecai.cl',
  sub: 'test-oauth-id-000',
  name: 'Letrado de prueba',
  picture: '',
  email_verified: true,
};

const verifyGoogleOAuth = async (req, res, next) => {
  try {
    if (config.skipAuth || process.env.NODE_ENV === 'test') {
      req.user = TEST_USER;
      req.tenantId = DEFAULT_TENANT_ID;
      return next();
    }

    const userInfoHeader = req.headers['x-apigateway-api-userinfo'];
    const authHeader = req.headers['x-forwarded-authorization'] || req.headers['authorization'];

    if (!userInfoHeader && !authHeader) {
      return res.status(401).json({ status: 'error', code: 'NO_AUTH', message: 'Auth requerida.' });
    }

    let userInfo = null;

    if (userInfoHeader) {
      try {
        userInfo = JSON.parse(Buffer.from(userInfoHeader, 'base64').toString('utf-8'));
      } catch (err) {
        loggingService.warn('Could not decode gateway userinfo', { error: err.message });
      }
    }

    if (!userInfo && authHeader && client) {
      const token = authHeader.replace('Bearer ', '');
      try {
        const ticket = await client.verifyIdToken({ idToken: token, audience: config.googleClientId });
        const p = ticket.getPayload();
        userInfo = { sub: p.sub, email: p.email, name: p.name, picture: p.picture, email_verified: p.email_verified };
      } catch (err) {
        return res.status(401).json({ status: 'error', code: 'INVALID_TOKEN', message: 'Token inválido.' });
      }
    }

    if (!userInfo) {
      return res.status(401).json({ status: 'error', code: 'NO_USER_INFO', message: 'No hay información de usuario.' });
    }

    if (userInfo.email_verified === false) {
      return res.status(403).json({ status: 'error', code: 'EMAIL_NOT_VERIFIED', message: 'Email no verificado.' });
    }

    req.user = userInfo;
    req.tenantId = await resolveTenantId(userInfo.email);
    next();
  } catch (err) {
    loggingService.error('OAuth middleware error', { error: err.message });
    return res.status(500).json({ status: 'error', code: 'AUTH_ERROR', message: 'Error de autenticación.' });
  }
};

module.exports = { verifyGoogleOAuth };
