/**
 * Payment endpoint closure.
 *
 * No payment service is configured. Every POST fails before authentication,
 * privileged client acquisition, body parsing, order creation, or wallet I/O.
 */

const PAYMENTS_NOT_CONFIGURED = 'PAYMENTS_NOT_CONFIGURED';

const getAllowedOrigin = (requestOrigin) => {
  const allowed = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowed.length === 0) return requestOrigin || '*';
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
};

exports.handler = async function (event = {}) {
  const eventHeaders = event.headers || {};
  const requestOrigin = eventHeaders.origin || eventHeaders.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': getAllowedOrigin(requestOrigin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff',
  };
  const method = String(event.httpMethod || '').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  return {
    statusCode: 503,
    headers,
    body: JSON.stringify({ code: PAYMENTS_NOT_CONFIGURED }),
  };
};
