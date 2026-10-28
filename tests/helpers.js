// Each test file runs in its own process, so this gives every file a fresh
// in-memory database. Tests create their own accounts, so they don't need to
// clean up after each other.
process.env.DB_PATH = ':memory:';

const app = require('../src/app');
const db = require('../src/db');

let server;
let baseUrl;

async function startServer() {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${server.address().port}`;
}

function stopServer() {
  return new Promise((resolve) => server.close(resolve));
}

async function request(method, path, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(baseUrl + path, options);
  return { status: res.status, body: await res.json() };
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);

async function createAccount(name = 'Test User') {
  const res = await post('/accounts/createAccount', { name });
  return res.body.data;
}

let refCounter = 0;
function addTx(accountId, type, amount, referenceId) {
  return post(`/accounts/${accountId}/transactions`, {
    type,
    amount,
    description: `${type} of ${amount}`,
    reference_id: referenceId || `ref-${++refCounter}`,
  });
}

async function balanceOf(accountId) {
  const res = await get(`/accounts/${accountId}/balance`);
  return res.body.data.balance;
}

module.exports = {
  db,
  startServer,
  stopServer,
  get,
  post,
  request,
  createAccount,
  addTx,
  balanceOf,
};
