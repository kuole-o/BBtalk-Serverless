const config = require('../config');

// 日志级别定义
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class Logger {
  constructor(module) {
    this.module = module;
    this.logLevel = config.logLevel;
  }

  formatMessage(message, args) {
    if (!args?.length) return message;
    return args.reduce((msg, arg, index) =>
      msg.replace(`{${index}}`, arg), message);
  }

  _log(level, message, ...args) {
    if (level < this.logLevel) return;

    const formattedMessage = this.formatMessage(message, args);
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} [${this._getLevelName(level)}] [${this.module}] ${formattedMessage}`;

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(logMessage);
        break;
      case LogLevel.INFO:
        console.log(logMessage);
        break;
      case LogLevel.WARN:
        console.warn(logMessage);
        break;
      case LogLevel.ERROR:
        console.error(logMessage);
        break;
    }
  }

  _getLevelName(level) {
    return Object.entries(LogLevel)
      .find(([_, value]) => value === level)?.[0] || 'UNKNOWN';
  }

  debug(message, ...args) {
    this._log(LogLevel.DEBUG, message, ...args);
  }

  info(message, ...args) {
    this._log(LogLevel.INFO, message, ...args);
  }

  warn(message, ...args) {
    this._log(LogLevel.WARN, message, ...args);
  }

  error(message, ...args) {
    this._log(LogLevel.ERROR, message, ...args);
  }

  perf(message, startTime, ...args) {
    const duration = Date.now() - startTime;
    this._log(LogLevel.INFO, `${message} (耗时: ${duration}ms)`, ...args);
  }
}

module.exports = {
  LogLevel,
  createLogger: (module) => new Logger(module)
}; 