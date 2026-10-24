export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthenticated: () => new AppError(401, "UNAUTHENTICATED", "Sign in to continue."),
  forbidden: (msg = "You do not have permission to perform this action.") => new AppError(403, "FORBIDDEN", msg),
  mfaRequired: () =>
    new AppError(403, "MFA_REQUIRED", "Multifactor authentication is required for this account before continuing."),
  notFound: (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found.`),
  conflict: (code: string, msg: string) => new AppError(409, code, msg),
  badRequest: (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details),
  unprocessable: (code: string, msg: string) => new AppError(422, code, msg),
  unavailable: (code: string, msg: string) => new AppError(503, code, msg),
};
