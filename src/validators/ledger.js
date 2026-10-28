const { AppError } = require('../errors');
const { toMinor, MAX_AMOUNT } = require('../utils/money');
const {
  isUuid,
  requireObjectBody,
  checkUnknownFields,
  validationError,
} = require('./common');

const TYPES = ['credit', 'debit'];
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

// Each validator returns clean values or throws a 400.

function validateCreateAccount(body) {
  requireObjectBody(body);
  const errors = [];
  checkUnknownFields(body, ['name'], errors);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    errors.push({ field: 'name', message: 'is required and must be a non-empty string' });
  } else if (name.length > 100) {
    errors.push({ field: 'name', message: 'must be 100 characters or fewer' });
  }

  if (errors.length) throw validationError(errors);
  return { name };
}

// Shared by the transaction and transfer validators.
function checkAmount(body, errors) {
  const amountMinor = toMinor(body.amount);
  if (amountMinor === null) {
    errors.push({
      field: 'amount',
      message: `must be a number greater than 0 with at most 2 decimal places (max ${MAX_AMOUNT})`,
    });
  }
  return amountMinor;
}

function checkDescription(body, errors) {
  if (body.description === undefined || body.description === null) return '';
  if (typeof body.description !== 'string' || body.description.length > 255) {
    errors.push({ field: 'description', message: 'must be a string of at most 255 characters' });
    return '';
  }
  return body.description.trim();
}

function checkReferenceId(body, errors) {
  const referenceId = typeof body.reference_id === 'string' ? body.reference_id.trim() : '';
  if (!referenceId) {
    errors.push({ field: 'reference_id', message: 'is required and must be a non-empty string' });
  } else if (referenceId.length > 100) {
    errors.push({ field: 'reference_id', message: 'must be 100 characters or fewer' });
  }
  return referenceId;
}

function validateAddTransaction(body) {
  requireObjectBody(body);
  const errors = [];
  checkUnknownFields(body, ['type', 'amount', 'description', 'reference_id'], errors);

  if (!TYPES.includes(body.type)) {
    errors.push({ field: 'type', message: `must be one of: ${TYPES.join(', ')}` });
  }
  const amountMinor = checkAmount(body, errors);
  const description = checkDescription(body, errors);
  const referenceId = checkReferenceId(body, errors);

  if (errors.length) throw validationError(errors);
  return { type: body.type, amountMinor, description, referenceId };
}

function validateTransfer(body) {
  requireObjectBody(body);
  const errors = [];
  checkUnknownFields(
    body,
    ['from_account_id', 'to_account_id', 'amount', 'description', 'reference_id'],
    errors
  );

  for (const field of ['from_account_id', 'to_account_id']) {
    if (!isUuid(body[field])) {
      errors.push({ field, message: 'is required and must be a valid account id' });
    }
  }
  if (isUuid(body.from_account_id) && body.from_account_id === body.to_account_id) {
    errors.push({ field: 'to_account_id', message: 'must be different from from_account_id' });
  }
  const amountMinor = checkAmount(body, errors);
  const description = checkDescription(body, errors);
  const referenceId = checkReferenceId(body, errors);

  if (errors.length) throw validationError(errors);
  return {
    fromAccountId: body.from_account_id,
    toAccountId: body.to_account_id,
    amountMinor,
    description,
    referenceId,
  };
}

function parsePositiveInt(raw, fallback) {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && Number.isSafeInteger(n) ? n : null;
}

function validateHistoryQuery(query) {
  const { type } = query;
  if (type !== undefined && !TYPES.includes(type)) {
    throw new AppError(400, 'INVALID_TRANSACTION_TYPE', `type must be one of: ${TYPES.join(', ')}`);
  }

  const page = parsePositiveInt(query.page, DEFAULT_PAGE);
  const limit = parsePositiveInt(query.limit, DEFAULT_LIMIT);
  const errors = [];
  if (page === null) errors.push({ field: 'page', message: 'must be a positive integer' });
  if (limit === null || limit > MAX_LIMIT) {
    errors.push({ field: 'limit', message: `must be an integer between 1 and ${MAX_LIMIT}` });
  }
  if (errors.length) {
    throw new AppError(400, 'INVALID_PAGINATION', 'Invalid pagination parameters', errors);
  }

  return { type, page, limit };
}

module.exports = {
  validateCreateAccount,
  validateAddTransaction,
  validateTransfer,
  validateHistoryQuery,
};
