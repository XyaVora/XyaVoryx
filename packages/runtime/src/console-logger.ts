import type { Logger } from "@xyavoryx/core";

export class ConsoleLogger implements Logger {
  debug(message: string, metadata?: Record<string, unknown>): void {
    console.debug(message, metadata ?? {});
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    console.info(message, metadata ?? {});
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    console.warn(message, metadata ?? {});
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    console.error(message, metadata ?? {});
  }
}