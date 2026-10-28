# Transaction Ledger API

A small REST API for a transaction ledger: create accounts, post credits and
debits, check balances, and page through transaction history. It also has the
bonus money-transfer endpoint.

Built with Node.js, Express and SQLite (via `better-sqlite3`).

## Running it

You need Node 18 or newer.

```bash
npm install
npm start
```

The API is now on `http://localhost:3000`. The SQLite database is created
automatically at `data/ledger.db` on first start, so there is nothing else to
set up.

| Variable  | Default          | What it does                                  |
|-----------|------------------|-----------------------------------------------|
| `PORT`    | `3000`           | Port to listen on                             |
| `DB_PATH` | `data/ledger.db` | Database file (`:memory:` for a throwaway DB) |

To run the tests:

```bash
npm test
```

The tests start the app against an in-memory database, so they never touch your
real data.

## Try it

```bash
# create an account
curl -X POST localhost:3000/accounts/createAccount \
  -H 'Content-Type: application/json' -d '{"name":"Asha"}'

# credit it (use the id from the response above)
curl -X POST localhost:3000/accounts/<ACCOUNT_ID>/transactions \
  -H 'Content-Type: application/json' \
  -d '{"type":"credit","amount":100,"description":"Opening deposit","reference_id":"dep-001"}'

# check the balance
curl localhost:3000/accounts/<ACCOUNT_ID>/balance

# history: debits only, 5 per page
curl 'localhost:3000/accounts/<ACCOUNT_ID>/transactions?type=debit&page=1&limit=5'
```

## Endpoints

| Method | Path                              | Purpose                          |
|--------|-----------------------------------|----------------------------------|
| POST   | `/accounts/createAccount`         | Create an account                |
| GET    | `/accounts/:id`                   | Get an account                   |
| GET    | `/accounts/:id/balance`           | Get the current balance          |
| POST   | `/accounts/:id/transactions`      | Add a credit or debit            |
| GET    | `/accounts/:id/transactions`      | Transaction history              |
| POST   | `/transfers`                      | Transfer between accounts (bonus)|
| GET    | `/health`                         | Liveness check                   |

Full request/response examples and every error code are in
[API.md](./API.md).

## How it's put together

```
src/
  server.js            starts the HTTP server
  app.js               Express setup and route mounting
  config.js            env vars
  errors.js            AppError (status + code + message)
  db/
    schema.sql         tables, constraints, triggers
    index.js           opens the database and applies the schema
  routes/              thin: validate input, call a service, send the response
  validators/          request validation, returns clean values or throws a 400
  services/            business rules and all the SQL
  middleware/          error handler and 404
  utils/money.js       decimal <-> cents conversion
tests/                 node:test + fetch against the real app
```

Routes don't contain business logic and services don't know about HTTP
(beyond throwing `AppError`s that carry a status code), which keeps each piece
small enough to read in one go.

## How data integrity is handled

**Atomicity.** Adding a transaction inserts the ledger row and updates the
balance inside a single SQLite transaction. If either step fails, both are
rolled back. Transfers do the same for all four writes (debit entry, credit
entry, balance updates, transfer record), so a half-finished transfer can't
exist. There is a test that forces the credit leg to fail and checks the debit
leg was undone.

**No overdrafts, even under concurrency.** Write transactions start with
`BEGIN IMMEDIATE`, which takes SQLite's write lock before the balance is read.
Two simultaneous debits are therefore serialised, and the second one sees the
balance left by the first. `accounts.balance` also has a `CHECK (balance >= 0)`
as a last line of defence.

**Duplicates / idempotency.** `UNIQUE (account_id, reference_id)` on the
transactions table. The service checks for the reference first so it can return
a helpful error that includes the original transaction; the constraint is there
to guarantee it even if that check were ever bypassed.

**Immutability.** There are no update or delete routes for transactions, and
database triggers abort any `UPDATE` or `DELETE` on the `transactions` and
`transfers` tables, so even a direct SQL statement can't change history.

**Balance consistency.** The balance is only ever changed by the same code path
that inserts a transaction. Rejected requests throw before anything is written.

**Money is stored as integer cents.** Floats are never added together, so
`0.1 + 0.2` style drift can't happen. Amounts accept at most 2 decimal places.

## Assumptions and decisions

These are choices I made where the brief was open. Easy to change if you'd
prefer something else.

1. **One currency, no currency field.** Amounts are plain decimals with two
   places.
2. **Duplicate `reference_id` returns `409 Conflict`.** The brief listed
   "duplicate transaction" among the error cases, so I treated it as an error.
   The body includes the existing transaction, so a client retrying after a
   timeout can still read what was recorded. No new transaction is created and
   the balance is untouched.
3. **Insufficient balance returns `422`.** The request is well-formed but
   can't be carried out against the current state. Some APIs use `400` or `409`
   here; the error `code` (`INSUFFICIENT_BALANCE`) is the stable thing to
   check.
4. **Account balance is always 0 at creation, and sending `balance` is a
   `400`** rather than being silently ignored, so a client doesn't think it
   worked. Any unknown field is rejected for the same reason (this catches
   typos like `referenceId`).
5. **`description` is optional** and defaults to an empty string. `type`,
   `amount` and `reference_id` are required.
6. **IDs are UUIDs.** A malformed id returns `400 INVALID_ACCOUNT_ID`; a
   well-formed id that doesn't exist returns `404 ACCOUNT_NOT_FOUND`.
7. **Pagination:** `page` defaults to 1, `limit` to 10, max 100. A page past the
   end returns an empty list, not an error. Newest first, with insertion order
   as the tiebreaker for transactions created in the same millisecond.
8. **Transfers** create two ordinary transactions (a debit on the source, a
   credit on the destination), so they appear in both histories and the
   balance rule stays "sum of all transactions". Their reference ids are
   generated by the system. The client's `reference_id` for a transfer is its
   idempotency key and is unique per source account, the same rule as for
   transactions. Transferring to the same account is rejected.
9. **No authentication.** The brief doesn't mention it, so any caller can
   touch any account.
10. **Amount limit** of 1,000,000,000 per transaction, to keep integer maths
    comfortably inside safe range.
11. **SQLite** because it needs no setup for whoever runs this. It runs in a
    single process with one writer at a time, which is more than enough here but
    is the thing to swap (for Postgres with `SELECT ... FOR UPDATE`) if this
    needed to scale horizontally.
