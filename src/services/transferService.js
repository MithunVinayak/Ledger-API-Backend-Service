const { randomUUID } = require('crypto');
const db = require('../db');
const { AppError } = require('../errors');
const { fromMinor } = require('../utils/money');
const { findAccountRow } = require('./accountService');
const { postEntry, present: presentTransaction } = require('./transactionService');

const insertTransfer = db.prepare(`
  INSERT INTO transfers
    (id, from_account_id, to_account_id, amount, description, reference_id,
     debit_transaction_id, credit_transaction_id, created_at)
  VALUES
    (@id, @from_account_id, @to_account_id, @amount, @description, @reference_id,
     @debit_transaction_id, @credit_transaction_id, @created_at)
`);
const selectTransfer = db.prepare('SELECT * FROM transfers WHERE id = ?');
const selectByReference = db.prepare(
  'SELECT * FROM transfers WHERE from_account_id = ? AND reference_id = ?'
);
const selectTransaction = db.prepare('SELECT * FROM transactions WHERE id = ?');

function present(row) {
  return {
    id: row.id,
    from_account_id: row.from_account_id,
    to_account_id: row.to_account_id,
    amount: fromMinor(row.amount),
    description: row.description,
    reference_id: row.reference_id,
    debit_transaction: presentTransaction(selectTransaction.get(row.debit_transaction_id)),
    credit_transaction: presentTransaction(selectTransaction.get(row.credit_transaction_id)),
    created_at: row.created_at,
  };
}

// Everything below runs inside one database transaction: if the credit leg
// (or anything else) throws, the debit leg is rolled back with it, so a
// half-finished transfer can't exist.
const transferTx = db.transaction((input) => {
  const { fromAccountId, toAccountId, amountMinor, description, referenceId } = input;

  // check both ends exist before touching any money
  findAccountRow(fromAccountId);
  findAccountRow(toAccountId);

  const existing = selectByReference.get(fromAccountId, referenceId);
  if (existing) {
    throw new AppError(
      409,
      'DUPLICATE_TRANSFER',
      'A transfer with this reference_id already exists for the source account',
      { existing_transfer: present(existing) }
    );
  }

  // the two legs get generated references so they can't collide with
  // anything the clients chose themselves
  const id = randomUUID();
  const debit = postEntry(fromAccountId, {
    type: 'debit',
    amountMinor,
    description: description || `Transfer to account ${toAccountId}`,
    referenceId: `transfer:${id}:debit`,
  });
  const credit = postEntry(toAccountId, {
    type: 'credit',
    amountMinor,
    description: description || `Transfer from account ${fromAccountId}`,
    referenceId: `transfer:${id}:credit`,
  });

  insertTransfer.run({
    id,
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    amount: amountMinor,
    description,
    reference_id: referenceId,
    debit_transaction_id: debit.id,
    credit_transaction_id: credit.id,
    created_at: new Date().toISOString(),
  });

  return present(selectTransfer.get(id));
});

function transfer(input) {
  return transferTx.immediate(input);
}

module.exports = { transfer };
