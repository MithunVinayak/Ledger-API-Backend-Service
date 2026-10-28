const { AppError } = require('../errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Makes sure the body is a JSON object and returns it.
function requireObjectBody(body) {
  if (!isPlainObject(body)) {
    throw new AppError(400, 'INVALID_BODY', 'Request body must be a JSON object');
  }
  return body;
}

// Flags fields we don't know about, so typos ("referenceId") don't get
// silently dropped. `balance` gets its own message because the spec is
// explicit that clients can't set it.
function checkUnknownFields(body, allowed, errors) {
  for (const key of Object.keys(body)) {
    if (allowed.includes(key)) continue;
    const message =
      key === 'balance'
        ? 'balance is managed by the system and cannot be set'
        : 'is not an allowed field';
    errors.push({ field: key, message });
  }
}

function validationError(errors) {
  return new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', errors);
}

module.exports = {
  isUuid,
  requireObjectBody,
  checkUnknownFields,
  validationError,
};
