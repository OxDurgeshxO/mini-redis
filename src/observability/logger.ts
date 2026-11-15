export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40
};

export class StructuredLogger {
  private currentLevel: LogLevel = "INFO";

  constructor(level: LogLevel = "INFO") {
    this.currentLevel = level;
  }

  public setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVEL_SEVERITY[level] < LOG_LEVEL_SEVERITY[this.currentLevel]) {
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      pid: process.pid,
      ...context
    };

    const serialized = JSON.stringify(entry);
    if (level === "ERROR") {
      process.stderr.write(serialized + "\n");
    } else {
      process.stdout.write(serialized + "\n");
    }
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.log("DEBUG", message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.log("INFO", message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.log("WARN", message, context);
  }

  public error(message: string, context?: Record<string, unknown>): void {
    this.log("ERROR", message, context);
  }
}

export const logger = new StructuredLogger((process.env.LOG_LEVEL as LogLevel) || "INFO");
