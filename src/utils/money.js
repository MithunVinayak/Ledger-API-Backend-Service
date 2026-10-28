// The API speaks in decimals (50.25), the database stores whole cents (5025).

const MAX_AMOUNT = 1_000_000_000;

// Returns the amount in cents, or null if it isn't a valid money value:
// a positive number, at most 2 decimal places, below the cap.
function toMinor(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  if (amount <= 0 || amount > MAX_AMOUNT) return null;

  const minor = Math.round(amount * 100);
  if (minor < 1) return null;
  if (Math.abs(amount * 100 - minor) > 1e-6) return null; // 3+ decimal places
  return minor;
}

function fromMinor(minor) {
  return minor / 100;
}

module.exports = { toMinor, fromMinor, MAX_AMOUNT };
