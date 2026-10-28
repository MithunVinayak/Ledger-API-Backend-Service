# API Documentation

Base URL: `http://localhost:3000`. All request and response bodies are JSON.

## Conventions

**Success** responses wrap the payload in `data`:

```json
{ "data": { ... } }
```

**Errors** always look like this:

```json
{
  "error": {
    "code": "SOME_CODE",
    "message": "Human readable explanation",
    "details": []
  }
}
```

`details` is only present when there is more to say (which fields failed
validation, the existing duplicate record, and so on). Clients should branch on
`code`, not `message`.

**Amounts** are JSON numbers with at most 2 decimal places. **Timestamps** are
ISO 8601 UTC strings. **IDs** are UUIDs.

---

## Create account

`POST /accounts/createAccount`

| Field  | Type   | Required | Notes                           |
|--------|--------|----------|---------------------------------|
| `name` | string | yes      | Non-empty, up to 100 characters |

`balance` is not accepted. Every account starts at `0`.

```bash
curl -X POST localhost:3000/accounts/createAccount -H 'Content-Type: application/json' \
  -d '{"name":"Asha"}'
```

`201 Created`

```json
{
  "data": {
    "id": "6f1c5a0e-7a53-4b8e-9c55-3f2f3a8f0f11",
    "name": "Asha",
    "balance": 0,
    "created_at": "2026-10-27T09:30:12.481Z"
  }
}
```

Errors: `400 VALIDATION_ERROR` (missing name, `balance` sent, unknown field),
`400 INVALID_JSON`, `400 INVALID_BODY`.

---

## Get account

`GET /accounts/:id`

`200 OK`, same shape as above. Errors: `404 ACCOUNT_NOT_FOUND`,
`400 INVALID_ACCOUNT_ID`.

---

## Get balance

`GET /accounts/:id/balance`

`200 OK`

```json
{ "data": { "account_id": "6f1c5a0e-7a53-4b8e-9c55-3f2f3a8f0f11", "balance": 100 } }
```

Errors: `404 ACCOUNT_NOT_FOUND`, `400 INVALID_ACCOUNT_ID`.

---

## Add transaction

`POST /accounts/:id/transactions`

| Field          | Type   | Required | Notes                                                     |
|----------------|--------|----------|-----------------------------------------------------------|
| `type`         | string | yes      | `credit` or `debit`                                       |
| `amount`       | number | yes      | Greater than 0, max 2 decimal places, up to 1,000,000,000 |
| `reference_id` | string | yes      | Unique per account, up to 100 characters                  |
| `description`  | string | no       | Up to 255 characters                                      |

```bash
curl -X POST localhost:3000/accounts/$ID/transactions \
  -H 'Content-Type: application/json' \
  -d '{"type":"debit","amount":30,"description":"Groceries","reference_id":"pos-8841"}'
```

`201 Created`

```json
{
  "data": {
    "id": "0d9f1a66-2b3e-4f43-a1c0-9d3d5a1b7e22",
    "account_id": "6f1c5a0e-7a53-4b8e-9c55-3f2f3a8f0f11",
    "type": "debit",
    "amount": 30,
    "description": "Groceries",
    "reference_id": "pos-8841",
    "created_at": "2026-10-27T09:31:40.002Z"
  }
}
```

The balance is updated in the same atomic operation.

### Errors

| Status | Code                    | When                                                                       |
|--------|-------------------------|----------------------------------------------------------------------------|
| 400    | `VALIDATION_ERROR`      | Bad `type`, bad `amount`, missing `reference_id`, unknown field. `details` lists each field. |
| 400    | `INVALID_JSON`          | Body isn't parseable JSON                                                  |
| 400    | `INVALID_BODY`          | Body isn't a JSON object                                                   |
| 400    | `INVALID_ACCOUNT_ID`    | Id in the URL isn't a UUID                                                 |
| 404    | `ACCOUNT_NOT_FOUND`     | No such account                                                            |
| 409    | `DUPLICATE_TRANSACTION` | This account already has a transaction with that `reference_id`            |
| 422    | `INSUFFICIENT_BALANCE`  | Debit is larger than the balance                                           |

Insufficient balance (`details` shows the balance and the amount asked for):

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance for this debit",
    "details": { "balance": 100, "requested": 150 }
  }
}
```

Duplicate (`details` contains the transaction that was recorded the first time;
nothing new is created and the balance does not change):

```json
{
  "error": {
    "code": "DUPLICATE_TRANSACTION",
    "message": "A transaction with this reference_id already exists for this account",
    "details": { "existing_transaction": { "id": "...", "reference_id": "pos-8841", "...": "..." } }
  }
}
```

The same `reference_id` may be used on different accounts.

---

## Transaction history

`GET /accounts/:id/transactions`

| Query   | Default | Notes                                   |
|---------|---------|-----------------------------------------|
| `type`  | (both)  | `credit` or `debit`                     |
| `page`  | `1`     | Positive integer                        |
| `limit` | `10`    | Integer from 1 to 100                   |

Newest first (by `created_at`).

```bash
curl "localhost:3000/accounts/$ID/transactions?type=credit&page=1&limit=2"
```

`200 OK`

```json
{
  "data": [
    {
      "id": "…",
      "account_id": "…",
      "type": "credit",
      "amount": 50,
      "description": "Refund",
      "reference_id": "ref-2",
      "created_at": "2026-10-27T09:35:00.120Z"
    }
  ],
  "pagination": {
    "current_page": 1,
    "page_size": 2,
    "total_records": 5,
    "total_pages": 3
  }
}
```

`total_records` and `total_pages` reflect the `type` filter. A page beyond the
last returns `"data": []`.

Errors: `400 INVALID_PAGINATION` (bad `page` or `limit`),
`400 INVALID_TRANSACTION_TYPE`, `400 INVALID_ACCOUNT_ID`, `404 ACCOUNT_NOT_FOUND`.

---

## Transfer money (bonus)

`POST /transfers`

| Field             | Type   | Required | Notes                                          |
|-------------------|--------|----------|------------------------------------------------|
| `from_account_id` | string | yes      | Source account                                 |
| `to_account_id`   | string | yes      | Destination account, must differ from source   |
| `amount`          | number | yes      | Same rules as for transactions                 |
| `reference_id`    | string | yes      | Unique per source account (idempotency key)    |
| `description`     | string | no       | Used on both ledger entries                    |

```bash
curl -X POST localhost:3000/transfers -H 'Content-Type: application/json' \
  -d '{"from_account_id":"'$A'","to_account_id":"'$B'","amount":30,"reference_id":"payout-17"}'
```

`201 Created`

```json
{
  "data": {
    "id": "…",
    "from_account_id": "…",
    "to_account_id": "…",
    "amount": 30,
    "description": "",
    "reference_id": "payout-17",
    "debit_transaction":  { "id": "…", "type": "debit",  "amount": 30, "...": "..." },
    "credit_transaction": { "id": "…", "type": "credit", "amount": 30, "...": "..." },
    "created_at": "2026-10-27T09:40:00.000Z"
  }
}
```

The debit, the credit, both balance updates and the transfer record are written
in one atomic operation. If anything fails, nothing is saved.

| Status | Code                   | When                                                         |
|--------|------------------------|--------------------------------------------------------------|
| 400    | `VALIDATION_ERROR`     | Bad ids, same source and destination, bad amount, etc.       |
| 404    | `ACCOUNT_NOT_FOUND`    | Either account doesn't exist                                 |
| 409    | `DUPLICATE_TRANSFER`   | Source account already used this `reference_id` for a transfer. `details` has the original. |
| 422    | `INSUFFICIENT_BALANCE` | Source balance is too low                                    |

---

## Other

`GET /health` returns `200 {"status":"ok"}`.

Unknown routes return `404 ROUTE_NOT_FOUND`. Unexpected failures return
`500 INTERNAL_ERROR` with a generic message (the details are logged on the
server, not sent to the client).

There are intentionally no endpoints to update or delete a transaction.
