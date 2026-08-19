import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = (message = "Authentication required") =>
  new HttpError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "Insufficient permissions") =>
  new HttpError(403, "FORBIDDEN", message);
export const notFound = (message = "Resource not found") =>
  new HttpError(404, "NOT_FOUND", message);
export const badRequest = (message = "Invalid request") =>
  new HttpError(400, "BAD_REQUEST", message);
export const conflict = (message = "Resource conflict") =>
  new HttpError(409, "CONFLICT", message);
export const payloadTooLarge = (message = "Payload too large") =>
  new HttpError(413, "PAYLOAD_TOO_LARGE", message);

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ code: "NOT_FOUND", message: "Route not found" });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path.join(".") ?? "";
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: path ? `${path}: ${first?.message}` : (first?.message ?? "Invalid request"),
    });
    return;
  }
  // Never leak internals to clients
  logger.error({ err }, "unhandled error");
  res.status(500).json({ code: "INTERNAL_ERROR", message: "Internal server error" });
}
