import pino from "pino";
import { TransportTargetOptions } from "pino";
import { Logger } from "pino";
import { LoggerOptions } from "pino";

export class Loggers {
  /**
   * A mapping from names to logger instances
   */
  private static readonly allLoggers: { [key: string]: Logger } = {};

  /**
   * The default (root) logger
   */
  private static readonly defaultLogger = Loggers.createDefaultLogger(
    true,
    undefined
  );

  /**
   * Internal function to create a pino Logger with default configuration.
   *
   * @param toConsole - Whether log output should be pretty-printed to the console
   * (default: `true`)
   * @param logFilePath - The path of the log file to write, or `undefined`
   * to write no log file (default: `undefined`)
   * @returns The Logger
   */
  private static createDefaultLogger(
    toConsole?: boolean,
    logFilePath?: string
  ): Logger {
    const consoleLogLevel = process.env.LOG_LEVEL || "trace";
    const fileLogLevel = process.env.LOG_LEVEL || "trace";
    const globalLogLevel = process.env.LOG_LEVEL || "trace";

    const transportTargetOptionsList: TransportTargetOptions[] = [];

    // The options for the 'console' transport target
    if (toConsole !== false) {
      const consoleTargetOptions = {
        level: consoleLogLevel,
        target: "pino-pretty",
        options: {},
      };
      transportTargetOptionsList.push(consoleTargetOptions);
    }

    // The options for the log file transport target
    if (logFilePath !== undefined) {
      const fileTargetOptions = {
        level: fileLogLevel,
        target: "pino/file",
        options: {
          destination: logFilePath,
          append: false,
        },
      };
      transportTargetOptionsList.push(fileTargetOptions);
    }

    // Create the actual transports based on the given options
    const transport = pino.transport({
      targets: transportTargetOptionsList,
    });

    // Common logger options
    const loggerOptions: LoggerOptions = {
      level: globalLogLevel,

      // Avoid adding the PID and hostname to each log
      base: undefined,

      // Format the time stamp as an ISO 8601-formatted time
      timestamp: pino.stdTimeFunctions.isoTime,
    };

    const logger = pino(loggerOptions, transport);
    Loggers.allLoggers[""] = logger;
    return logger;
  }

  /**
   * Derive a name for a logger from the given string.
   *
   * If the string contains path separators (i.e. if it contains `/`
   * or `\\`), then the part after the last `/` or `\\` will be
   * returned as the name. Otherwise, the given name will be returned.
   *
   * @param loggerName - The logger name
   * @returns The name
   */
  private static deriveName(loggerName: string): string {
    let index = -1;
    index = loggerName.lastIndexOf("/");
    index = Math.max(index, loggerName.lastIndexOf("\\"));
    if (index !== -1) {
      const name = loggerName.substring(index + 1);
      return name;
    }
    return loggerName;
  }

  /**
   * Set the log level that is supposed to be used for all loggers
   *
   * @param level - The log level
   */
  static setLevel(level: string) {
    for (const logger of Object.values(Loggers.allLoggers)) {
      logger.level = level;
    }
  }

  /**
   * Returns the logger for the specified name.
   *
   * If the `loggerName` is undefined or an empty string, then a default
   * logger will be returned. If the logger for the specified name does
   * not yet exist, then it will be created.
   *
   * The given name will be included as a `name` in the log messages.
   * If the given name is a path (i.e. if it contains `/` or `\\`),
   * then the part after the last `/` or `\\` will be used as the name.
   *
   * Example:
   * ```
   * import { Loggers } from "../src/logging/Loggers";
   * const logger = Loggers.get(__filename);
   * ```
   *
   * @param loggerName - An optional name
   * @returns The Logger
   */
  static get(loggerName?: string): Logger {
    if (loggerName === undefined) {
      return Loggers.defaultLogger;
    }
    const name = Loggers.deriveName(loggerName);
    let logger = Loggers.allLoggers[name];
    if (logger === undefined) {
      logger = Loggers.defaultLogger.child({ name: name });
      Loggers.allLoggers[name] = logger;
    }
    return logger;
  }
}