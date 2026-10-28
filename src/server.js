const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`Ledger API listening on http://localhost:${config.port}`);
});
