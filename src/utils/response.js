// Bentuk respons standar API (lihat docs/technical/api-contract.md, bagian Konvensi).

function sendSuccess(res, data, { status = 200, meta } = {}) {
  const body = { data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function errorBody(code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return { error };
}

module.exports = { sendSuccess, ApiError, errorBody };
