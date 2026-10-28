// An error we know how to turn into an HTTP response.
// `code` is a stable machine-readable string, `message` is for humans.
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { AppError };
