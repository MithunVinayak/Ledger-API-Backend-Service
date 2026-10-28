const { randomUUID } = require('crypto');
const db = require('../db');
const { AppError } = require('../errors');
const { fromMinor } = require('../utils/money');
const { findAccountRow } = require('./accountService');

const insertTransaction = db.prepare(`
  INSERT INTO transactions (id, account_id, type, amount, description, reference_id, created_at)
  VALUES (@id, @account_id, @type, @amount, @description, @reference_id, @created_at)
`);
const selectTransaction = db.prepare('SELECT * FROM transactions WHERE id = ?');
const selectByReference = db.prepare(
  'SELECT * FROM transactions WHERE account_id = ? AND reference_id = ?'
);
const adjustBalance = db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?');

function present(row) {
  return {
    id: row.id,
    account_id: row.account_id,
    type: row.type,
    amount: fromMinor(row.amount),
    description: row.description,
    reference_id: row.reference_id,
    created_at: row.created_at,
  };
}

// Writes one ledger entry and moves the balance. This does NOT open its own
// database transaction, so the caller has to be inside one (addTransaction and
// transferService both are). That way the insert and the balance update can
// never be applied separately.
function postEntry(accountId, { type, amountMinor, description, referenceId }) {
  const account = findAccountRow(accountId);

  if (type === 'debit' && account.balance < amountMinor) {
    throw new AppError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance for this debit', {
      balance: fromMinor(account.balance),
      requested: fromMinor(amountMinor),
    });
  }

  const id = randomUUID();
  insertTransaction.run({
    id,
    account_id: accountId,
    type,
    amount: amountMinor,
    description,
    reference_id: referenceId,
    created_at: new Date().toISOString(),
  });
  adjustBalance.run(type === 'credit' ? amountMinor : -amountMinor, accountId);

  return present(selectTransaction.get(id));
}

// .immediate() takes the write lock up front, so the balance we read for the
// sufficient-funds check can't change underneath us.
const addTransactionTx = db.transaction((accountId, input) => {
  findAccountRow(accountId);

  const existing = selectByReference.get(accountId, input.referenceId);
  if (existing) {
    throw new AppError(
      409,
      'DUPLICATE_TRANSACTION',
      'A transaction with this reference_id already exists for this account',
      { existing_transaction: present(existing) }
    );
  }

  return postEntry(accountId, input);
});

function addTransaction(accountId, input) {
  return addTransactionTx.immediate(accountId, input);
}

function listTransactions(accountId, { type, page, limit }) {
  findAccountRow(accountId);

  const typeClause = type ? 'AND type = @type' : '';
  const params = { accountId, type };

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM transactions WHERE account_id = @accountId ${typeClause}`)
    .get(params);

  // rowid breaks ties when two transactions land in the same millisecond
  const rows = db
    .prepare(
      `SELECT * FROM transactions
       WHERE account_id = @accountId ${typeClause}
       ORDER BY created_at DESC, rowid DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset: (page - 1) * limit });

  return {
    data: rows.map(present),
    pagination: {
      current_page: page,
      page_size: limit,
      total_records: total,
      total_pages: Math.ceil(total / limit),
    },
  };
}

module.exports = { addTransaction, listTransactions, postEntry, present };
