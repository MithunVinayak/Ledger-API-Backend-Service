-- Amounts and balances are stored as integer minor units (cents) so we never
-- do arithmetic on floats. The API converts to/from decimals at the edge.

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts (id),
  type          TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  description   TEXT NOT NULL DEFAULT '',
  reference_id  TEXT NOT NULL CHECK (length(trim(reference_id)) > 0),
  created_at    TEXT NOT NULL,

  -- the idempotency rule: one reference per account, but different accounts
  -- are free to reuse the same reference
  UNIQUE (account_id, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_created
  ON transactions (account_id, created_at DESC);

-- A transfer is just two ledger entries (a debit and a credit) plus a row here
-- that ties them together and carries its own idempotency key.
CREATE TABLE IF NOT EXISTS transfers (
  id                     TEXT PRIMARY KEY,
  from_account_id        TEXT NOT NULL REFERENCES accounts (id),
  to_account_id          TEXT NOT NULL REFERENCES accounts (id),
  amount                 INTEGER NOT NULL CHECK (amount > 0),
  description            TEXT NOT NULL DEFAULT '',
  reference_id           TEXT NOT NULL CHECK (length(trim(reference_id)) > 0),
  debit_transaction_id   TEXT NOT NULL REFERENCES transactions (id),
  credit_transaction_id  TEXT NOT NULL REFERENCES transactions (id),
  created_at             TEXT NOT NULL,

  CHECK (from_account_id <> to_account_id),
  UNIQUE (from_account_id, reference_id)
);

-- Ledger rows are append-only. Even if someone writes a bad query (or opens the
-- database by hand), a transaction can't be edited or removed.
CREATE TRIGGER IF NOT EXISTS transactions_no_update
BEFORE UPDATE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS transactions_no_delete
BEFORE DELETE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS transfers_no_update
BEFORE UPDATE ON transfers
BEGIN
  SELECT RAISE(ABORT, 'transfers are immutable');
END;

CREATE TRIGGER IF NOT EXISTS transfers_no_delete
BEFORE DELETE ON transfers
BEGIN
  SELECT RAISE(ABORT, 'transfers cannot be deleted');
END;
