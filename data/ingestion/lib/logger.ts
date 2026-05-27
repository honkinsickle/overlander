/**
 * Pino logger with secret-redaction defaults.
 *
 * Pretty-printed in development, JSON in CI/production.
 * Redacts any field whose path contains a secret-shaped name.
 */

import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "*.key",
      "*.apiKey",
      "*.api_key",
      "*.token",
      "*.secret",
      "*.password",
      "*.serviceRoleKey",
      "*.service_role_key",
      "headers.authorization",
      "headers['x-goog-api-key']",
      "headers['apikey']",
    ],
    censor: "[redacted]",
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l" },
        },
      }
    : {}),
});
