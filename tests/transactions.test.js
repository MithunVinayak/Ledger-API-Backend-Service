const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.startServer);
after(h.stopServer);

test('a credit increases the balance', async () => {
  const account = await h.createAccount();
  await h.addTx(account.id, 'credit', 100);

  const res = await h.addTx(account.id, 'credit', 50);

  assert.equal(res.status, 201);
  assert.equal(res.body.data.type, 'credit');
  assert.equal(res.body.data.amount, 50);
  assert.equal(await h.balanceOf(account.id), 150);
});

test('a debit decreases the balance', async () => {
  const account = await h.createAccount();
  await h.addTx(account.id, 'credit', 100);

  const res = await h.addTx(account.id, 'debit', 30);

  assert.equal(res.status, 201);
  assert.equal(await h.balanceOf(account.id), 70);
});

test('a debit larger than the balance is rejected and changes nothing', async () => {
  const account = await h.createAccount();
  await h.addTx(account.id, 'credit', 100);

  const res = await h.addTx(account.id, 'debit', 150);

  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'INSUFFICIENT_BALANCE');
  assert.equal(await h.balanceOf(account.id), 100);

  const history = await h.get(`/accounts/${account.id}/transactions`);
  assert.equal(history.body.pagination.total_records, 1);
});

test('debiting the exact balance is allowed', async () => {
  const account = await h.createAccount();
  await h.addTx(account.id, 'credit', 25.5);

  const res = await h.addTx(account.id, 'debit', 25.5);

  assert.equal(res.status, 201);
  assert.equal(await h.balanceOf(account.id), 0);
});

test('balance matches the sum of all valid transactions', async () => {
  const account = await h.createAccount();
  await h.addTx(account.id, 'credit', 100);
  await h.addTx(account.id, 'credit', 50);
  await h.addTx(account.id, 'debit', 30);
  await h.addTx(account.id, 'debit', 20);
  await h.addTx(account.id, 'debit', 9999); // rejected, shouldn't count

  assert.equal(await h.balanceOf(account.id), 100);
});

test('decimal amounts do not drift', async () => {
  const account = await h.createAccount();
  for (let i = 0; i < 10; i++) await h.addTx(account.id, 'credit', 0.1);

  assert.equal(await h.balanceOf(account.id), 1);
});

test('a repeated reference_id is rejected without a new transaction or balance change', async () => {
  const account = await h.createAccount();
  const first = await h.addTx(account.id, 'credit', 100, 'order-1');
  assert.equal(first.status, 201);

  const repeat = await h.addTx(account.id, 'credit', 100, 'order-1');

  assert.equal(repeat.status, 409);
  assert.equal(repeat.body.error.code, 'DUPLICATE_TRANSACTION');
  assert.equal(repeat.body.error.details.existing_transaction.id, first.body.data.id);
  assert.equal(await h.balanceOf(account.id), 100);

  const history = await h.get(`/accounts/${account.id}/transactions`);
  assert.equal(history.body.pagination.total_records, 1);
});

test('the same reference_id can be used on different accounts', async () => {
  const a = await h.createAccount('A');
  const b = await h.createAccount('B');

  const onA = await h.addTx(a.id, 'credit', 10, 'shared-ref');
  const onB = await h.addTx(b.id, 'credit', 10, 'shared-ref');

  assert.equal(onA.status, 201);
  assert.equal(onB.status, 201);
});

test('validates the transaction body', async () => {
  const account = await h.createAccount();
  const url = `/accounts/${account.id}/transactions`;
  const valid = { type: 'credit', amount: 10, reference_id: 'r' };

  const cases = {
    'bad type': { ...valid, type: 'refund' },
    'missing type': { amount: 10, reference_id: 'r' },
    'zero amount': { ...valid, amount: 0 },
    'negative amount': { ...valid, amount: -5 },
    'string amount': { ...valid, amount: '10' },
    'too many decimals': { ...valid, amount: 1.234 },
    'missing amount': { type: 'credit', reference_id: 'r' },
    'missing reference_id': { type: 'credit', amount: 10 },
    'blank reference_id': { ...valid, reference_id: '  ' },
    'unknown field': { ...valid, referenceId: 'x' },
  };

  for (const [label, body] of Object.entries(cases)) {
    const res = await h.post(url, body);
    assert.equal(res.status, 400, label);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR', label);
  }
  assert.equal(await h.balanceOf(account.id), 0);
});

test('adding a transaction to a missing account returns 404', async () => {
  const res = await h.addTx('11111111-1111-4111-8111-111111111111', 'credit', 10);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'ACCOUNT_NOT_FOUND');
});

test('transactions cannot be edited or deleted, even straight in the database', async () => {
  const account = await h.createAccount();
  const { body } = await h.addTx(account.id, 'credit', 10);
  const id = body.data.id;

  assert.throws(() => h.db.prepare('UPDATE transactions SET amount = 999 WHERE id = ?').run(id), /immutable/);
  assert.throws(() => h.db.prepare('DELETE FROM transactions WHERE id = ?').run(id), /cannot be deleted/);

  // and the API has no route for it
  const del = await h.request('DELETE', `/accounts/${account.id}/transactions/${id}`);
  assert.equal(del.status, 404);
  const put = await h.request('PUT', `/accounts/${account.id}/transactions/${id}`, { amount: 1 });
  assert.equal(put.status, 404);
});

test('the database itself refuses a negative balance', async () => {
  const account = await h.createAccount();
  assert.throws(
    () => h.db.prepare('UPDATE accounts SET balance = -1 WHERE id = ?').run(account.id),
    /CHECK constraint/
  );
});
