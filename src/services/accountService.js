const { randomUUID } = require('crypto');
const db = require('../db');
const { AppError } = require('../errors');
const { fromMinor } = require('../utils/money');

const insertAccount = db.prepare(
  'INSERT INTO accounts (id, name, balance, created_at) VALUES (?, ?, 0, ?)'
);
const selectAccount = db.prepare('SELECT * FROM accounts WHERE id = ?');

function present(row) {
  return {
    id: row.id,
    name: row.name,
    balance: fromMinor(row.balance),
    created_at: row.created_at,
  };
}

// Raw row (balance in cents). Used by the other services too.
function findAccountRow(id) {
  const row = selectAccount.get(id);
  if (!row) {
    throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Account ${id} was not found`);
  }
  return row;
}

function createAccount({ name }) {
  // balance is not a parameter on purpose: every account starts at 0
  const id = randomUUID();
  insertAccount.run(id, name, new Date().toISOString());
  return present(selectAccount.get(id));
}

function getAccount(id) {
  return present(findAccountRow(id));
}

function getBalance(id) {
  const row = findAccountRow(id);
  return { account_id: row.id, balance: fromMinor(row.balance) };
}

module.exports = { createAccount, getAccount, getBalance, findAccountRow };
