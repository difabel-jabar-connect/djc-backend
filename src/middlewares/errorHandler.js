const env = require('../config/env');
const { ApiError, errorBody } = require('../utils/response');

// eslint-disable-next-line no-unused-vars -- Express mengenali error handler dari 4 parameter.
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json(errorBody(err.code, err.message, err.details));
  }

  // Body JSON rusak dari express.json().
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json(errorBody('INVALID_JSON', 'Body request bukan JSON yang valid.'));
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Body request terlalu besar.'));
  }

  if (!env.isTest) {
    console.error(err);
  }
  return res
    .status(500)
    .json(errorBody('INTERNAL_ERROR', 'Terjadi kesalahan pada server. Silakan coba lagi.'));
}

module.exports = errorHandler;
