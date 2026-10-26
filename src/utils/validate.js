const { ApiError } = require('./response');

/**
 * Validasi data request dengan skema zod. Jika gagal, lempar 400 VALIDATION_ERROR
 * dengan `details` per field sesuai format error di api-contract.md.
 */
function validate(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;

  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  throw new ApiError(400, 'VALIDATION_ERROR', 'Data yang dikirim belum valid.', details);
}

module.exports = { validate };
