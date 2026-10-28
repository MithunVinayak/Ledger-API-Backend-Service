const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.startServer);
after(h.stopServer);

test('creates an account with a zero balance and system-generated fields', async () => {
  const res = await h.post('/accounts/createAccount', { name: '  Asha  ' });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.name, 'Asha');
  assert.equal(res.body.data.balance, 0);
  assert.ok(res.body.data.id);
  assert.ok(!Number.isNaN(Date.parse(res.body.data.created_at)));
});

test('gives each account a unique id', async () => {
  const a = await h.createAccount('A');
  const b = await h.createAccount('B');
  assert.notEqual(a.id, b.id);
});

test('rejects a missing or blank name', async () => {
  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 42 }]) {
    const res = await h.post('/accounts/createAccount', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('does not let the client set the balance', async () => {
  const res = await h.post('/accounts/createAccount', { name: 'Sneaky', balance: 1000 });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.details[0].field, 'balance');
});

test('rejects malformed JSON and non-object bodies', async () => {
  const bad = await h.request('POST', '/accounts/createAccount', '{"name": ');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_JSON');

  const array = await h.post('/accounts/createAccount', []);
  assert.equal(array.status, 400);
  assert.equal(array.body.error.code, 'INVALID_BODY');
});

test('returns the balance for an account', async () => {
  const account = await h.createAccount();
  const res = await h.get(`/accounts/${account.id}/balance`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, { account_id: account.id, balance: 0 });
});

test('returns 404 for an unknown account and 400 for a malformed id', async () => {
  const missing = await h.get('/accounts/11111111-1111-4111-8111-111111111111/balance');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'ACCOUNT_NOT_FOUND');

  const malformed = await h.get('/accounts/not-an-id/balance');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, 'INVALID_ACCOUNT_ID');
});

test('unknown routes get the standard error shape', async () => {
  const res = await h.get('/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
});
