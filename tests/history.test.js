const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.startServer);
after(h.stopServer);

// 5 credits and 3 debits, oldest first: c1 c2 d1 c3 d2 c4 d3 c5
async function seededAccount() {
  const account = await h.createAccount();
  const order = ['c1', 'c2', 'd1', 'c3', 'd2', 'c4', 'd3', 'c5'];
  for (const ref of order) {
    await h.addTx(account.id, ref.startsWith('c') ? 'credit' : 'debit', ref.startsWith('c') ? 100 : 10, ref);
  }
  return account;
}

test('returns newest first', async () => {
  const account = await seededAccount();
  const res = await h.get(`/accounts/${account.id}/transactions?limit=100`);

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.data.map((t) => t.reference_id),
    ['c5', 'd3', 'c4', 'd2', 'c3', 'd1', 'c2', 'c1']
  );
});

test('returns both types when no filter is given', async () => {
  const account = await seededAccount();
  const res = await h.get(`/accounts/${account.id}/transactions`);

  assert.equal(res.body.pagination.total_records, 8);
});

test('filters by type', async () => {
  const account = await seededAccount();

  const credits = await h.get(`/accounts/${account.id}/transactions?type=credit&limit=100`);
  assert.equal(credits.body.data.length, 5);
  assert.ok(credits.body.data.every((t) => t.type === 'credit'));

  const debits = await h.get(`/accounts/${account.id}/transactions?type=debit&limit=100`);
  assert.equal(debits.body.data.length, 3);
  assert.ok(debits.body.data.every((t) => t.type === 'debit'));
});

test('paginates and reports page info', async () => {
  const account = await seededAccount();

  const page1 = await h.get(`/accounts/${account.id}/transactions?page=1&limit=3`);
  assert.deepEqual(page1.body.pagination, {
    current_page: 1,
    page_size: 3,
    total_records: 8,
    total_pages: 3,
  });
  assert.deepEqual(page1.body.data.map((t) => t.reference_id), ['c5', 'd3', 'c4']);

  const page3 = await h.get(`/accounts/${account.id}/transactions?page=3&limit=3`);
  assert.deepEqual(page3.body.data.map((t) => t.reference_id), ['c2', 'c1']);
});

test('pagination totals respect the type filter', async () => {
  const account = await seededAccount();
  const res = await h.get(`/accounts/${account.id}/transactions?type=debit&limit=2`);

  assert.equal(res.body.pagination.total_records, 3);
  assert.equal(res.body.pagination.total_pages, 2);
});

test('a page past the end is empty, not an error', async () => {
  const account = await seededAccount();
  const res = await h.get(`/accounts/${account.id}/transactions?page=99`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
});

test('an account with no transactions returns an empty list', async () => {
  const account = await h.createAccount();
  const res = await h.get(`/accounts/${account.id}/transactions`);

  assert.deepEqual(res.body.data, []);
  assert.equal(res.body.pagination.total_pages, 0);
});

test('rejects invalid pagination and type values', async () => {
  const account = await h.createAccount();
  const base = `/accounts/${account.id}/transactions`;

  for (const query of ['page=0', 'page=-1', 'page=abc', 'page=1.5', 'limit=0', 'limit=101', 'limit=abc']) {
    const res = await h.get(`${base}?${query}`);
    assert.equal(res.status, 400, query);
    assert.equal(res.body.error.code, 'INVALID_PAGINATION', query);
  }

  const badType = await h.get(`${base}?type=refund`);
  assert.equal(badType.status, 400);
  assert.equal(badType.body.error.code, 'INVALID_TRANSACTION_TYPE');
});

test('history for a missing account returns 404', async () => {
  const res = await h.get('/accounts/11111111-1111-4111-8111-111111111111/transactions');
  assert.equal(res.status, 404);
});
