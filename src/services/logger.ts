import { systemClock } from "./clock.js";

type LogContext = Record<string, string | number | boolean | null>;

function write(
  level: "info" | "warn" | "error",
  message: string,
  context: LogContext = {},
): void {
  const entry = JSON.stringify({
    timestamp: systemClock.now().toISOString(),
    level,
    message,
    ...context,
  });

  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.info(entry);
  }
}

export const logger = {
  info: (message: string, context?: LogContext) =>
    write("info", message, context),
  warn: (message: string, context?: LogContext) =>
    write("warn", message, context),
  error: (message: string, context?: LogContext) =>
    write("error", message, context),
};
