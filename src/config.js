const path = require('path');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  // set DB_PATH=:memory: for a throwaway database
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'ledger.db'),
};
