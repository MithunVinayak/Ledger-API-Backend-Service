const express = require('express');
const { AppError } = require('../errors');
const { isUuid } = require('../validators/common');
const {
  validateCreateAccount,
  validateAddTransaction,
  validateHistoryQuery,
} = require('../validators/ledger');
const accountService = require('../services/accountService');
const transactionService = require('../services/transactionService');

const router = express.Router();

// Runs for every route that has :accountId in the path
router.param('accountId', (req, res, next, value) => {
  if (!isUuid(value)) {
    return next(new AppError(400, 'INVALID_ACCOUNT_ID', `"${value}" is not a valid account id`));
  }
  next();
});


router.post('/createAccount', (req, res) => {
  const account = accountService.createAccount(validateCreateAccount(req.body));
  res.status(201).json({ data: account });
});

router.get('/:accountId', (req, res) => {
  res.json({ data: accountService.getAccount(req.params.accountId) });
});

router.get('/:accountId/balance', (req, res) => {
  res.json({ data: accountService.getBalance(req.params.accountId) });
});

router.post('/:accountId/transactions', (req, res) => {
  const input = validateAddTransaction(req.body);
  const transaction = transactionService.addTransaction(req.params.accountId, input);
  res.status(201).json({ data: transaction });
});

router.get('/:accountId/transactions', (req, res) => {
  const query = validateHistoryQuery(req.query);
  res.json(transactionService.listTransactions(req.params.accountId, query));
});

module.exports = router;
