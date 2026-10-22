const { ApiError } = require('../utils/response');

function notFound(req, res, next) {
  next(new ApiError(404, 'NOT_FOUND', `Endpoint ${req.method} ${req.path} tidak ditemukan.`));
}

module.exports = notFound;
