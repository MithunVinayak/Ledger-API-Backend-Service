const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.startServer);
after(h.stopServer);

function transferBody(from, to, amount, referenceId = `t-${Math.random()}`) {
  return { from_account_id: from, to_account_id: to, amount, reference_id: referenceId };
}

async function fundedPair(a = 100, b = 50) {
  const from = await h.createAccount('Source');
  const to = await h.createAccount('Destination');
  await h.addTx(from.id, 'credit', a);
  await h.addTx(to.id, 'credit', b);
  return { from, to };
}

test('moves money from one account to the other', async () => {
  const { from, to } = await fundedPair(100, 50);

  const res = await h.post('/transfers', transferBody(from.id, to.id, 30));

  assert.equal(res.status, 201);
  assert.equal(res.body.data.amount, 30);
  assert.equal(res.body.data.debit_transaction.type, 'debit');
  assert.equal(res.body.data.credit_transaction.type, 'credit');
  assert.equal(await h.balanceOf(from.id), 70);
  assert.equal(await h.balanceOf(to.id), 80);
});

test('both legs show up in each account history', async () => {
  const { from, to } = await fundedPair();
  await h.post('/transfers', transferBody(from.id, to.id, 30));

  const fromHistory = await h.get(`/accounts/${from.id}/transactions?type=debit`);
  const toHistory = await h.get(`/accounts/${to.id}/transactions?type=credit&limit=1`);
  assert.equal(fromHistory.body.data[0].amount, 30);
  assert.equal(toHistory.body.data[0].amount, 30);
});

test('an overdraw is rejected and neither account changes', async () => {
  const { from, to } = await fundedPair(100, 50);

  const res = await h.post('/transfers', transferBody(from.id, to.id, 500));

  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'INSUFFICIENT_BALANCE');
  assert.equal(await h.balanceOf(from.id), 100);
  assert.equal(await h.balanceOf(to.id), 50);

  const history = await h.get(`/accounts/${to.id}/transactions`);
  assert.equal(history.body.pagination.total_records, 1);
});

test('a failure on the credit leg rolls back the debit leg', async () => {
  const { from, to } = await fundedPair(100, 50);

  // Force the second leg to blow up: block inserts for the destination account.
  h.db.exec(`
    CREATE TEMP TRIGGER fail_credit BEFORE INSERT ON transactions
    WHEN NEW.account_id = '${to.id}' AND NEW.type = 'credit'
    BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
  `);

  try {
    const res = await h.post('/transfers', transferBody(from.id, to.id, 30));
    assert.equal(res.status, 500);
  } finally {
    h.db.exec('DROP TRIGGER fail_credit');
  }

  // no partial transfer: source balance and history are untouched
  assert.equal(await h.balanceOf(from.id), 100);
  assert.equal(await h.balanceOf(to.id), 50);
  const history = await h.get(`/accounts/${from.id}/transactions`);
  assert.equal(history.body.pagination.total_records, 1);
});

test('both accounts must exist', async () => {
  const { from } = await fundedPair();
  const ghost = '11111111-1111-4111-8111-111111111111';

  const missingDestination = await h.post('/transfers', transferBody(from.id, ghost, 10));
  assert.equal(missingDestination.status, 404);

  const missingSource = await h.post('/transfers', transferBody(ghost, from.id, 10));
  assert.equal(missingSource.status, 404);

  assert.equal(await h.balanceOf(from.id), 100);
});

test('rejects a transfer to the same account and other bad input', async () => {
  const { from, to } = await fundedPair();

  const cases = [
    transferBody(from.id, from.id, 10),
    transferBody(from.id, to.id, 0),
    transferBody(from.id, to.id, -5),
    transferBody('nope', to.id, 10),
    { from_account_id: from.id, to_account_id: to.id, amount: 10 }, // no reference_id
  ];
  for (const body of cases) {
    const res = await h.post('/transfers', body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(await h.balanceOf(from.id), 100);
});

test('repeating a transfer reference does not move money twice', async () => {
  const { from, to } = await fundedPair(100, 50);
  const body = transferBody(from.id, to.id, 30, 'payout-1');

  const first = await h.post('/transfers', body);
  const repeat = await h.post('/transfers', body);

  assert.equal(first.status, 201);
  assert.equal(repeat.status, 409);
  assert.equal(repeat.body.error.code, 'DUPLICATE_TRANSFER');
  assert.equal(await h.balanceOf(from.id), 70);
  assert.equal(await h.balanceOf(to.id), 80);
});

test('different sources can reuse a transfer reference, even into the same destination', async () => {
  const to = await h.createAccount('Shared destination');
  const a = await h.createAccount('A');
  const b = await h.createAccount('B');
  await h.addTx(a.id, 'credit', 20);
  await h.addTx(b.id, 'credit', 20);

  const fromA = await h.post('/transfers', transferBody(a.id, to.id, 5, 'same-ref'));
  const fromB = await h.post('/transfers', transferBody(b.id, to.id, 5, 'same-ref'));

  assert.equal(fromA.status, 201);
  assert.equal(fromB.status, 201);
  assert.equal(await h.balanceOf(to.id), 10);
});
