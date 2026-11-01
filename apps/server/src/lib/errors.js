export class AppError extends Error {
  constructor(message, { status = 400, code = 'BAD_REQUEST', details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You are not allowed to perform this action.', details = null) {
    super(message, { status: 403, code: 'FORBIDDEN', details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.', details = null) {
    super(message, { status: 404, code: 'NOT_FOUND', details });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The resource changed. Refresh and try again.', details = null) {
    super(message, { status: 409, code: 'CONFLICT', details });
  }
}

export class BotOfflineError extends AppError {
  constructor(message = 'The bot is offline. Discord actions are unavailable.') {
    super(message, { status: 409, code: 'BOT_OFFLINE' });
  }
}

export function assert(condition, message, options) {
  if (!condition) throw new AppError(message, options);
}
