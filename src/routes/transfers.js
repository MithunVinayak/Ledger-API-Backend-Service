const express = require('express');
const { validateTransfer } = require('../validators/ledger');
const transferService = require('../services/transferService');

const router = express.Router();

router.post('/', (req, res) => {
  const transfer = transferService.transfer(validateTransfer(req.body));
  res.status(201).json({ data: transfer });
});

module.exports = router;
