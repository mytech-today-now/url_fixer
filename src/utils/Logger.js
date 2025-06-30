/**
 * Logger utility for consistent logging across the application
 * Follows the specified error format: [HH:MM:SS AM/PM] <Element> tag #X: <message> at line L, column C
 */

'use strict';

export class Logger {
  constructor(context = 'App') {
    this.context = context;
    this.logLevel = this.getLogLevel();
  }

  /**
   * Get the current log level from localStorage or default to 'info'
   */
  getLogLevel() {
    try {
      return localStorage.getItem('url-fixer-log-level') || 'info';
    } catch {
      return 'info';
    }
  }

  /**
   * Set the log level
   */
  setLogLevel(level) {
    this.logLevel = level;
    try {
      localStorage.setItem('url-fixer-log-level', level);
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Format timestamp in the required format
   */
  formatTimestamp() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * Get stack trace information
   */
  getStackInfo() {
    const stack = new Error().stack;
    if (!stack) return { line: 'unknown', column: 'unknown' };

    // Parse stack trace to get line and column info
    const stackLines = stack.split('\n');
    // Skip the first few lines (Error, getStackInfo, log method)
    const callerLine = stackLines[4] || stackLines[3] || '';
    
    const match = callerLine.match(/:(\d+):(\d+)/);
    if (match) {
      return {
        line: match[1],
        column: match[2]
      };
    }
    
    return { line: 'unknown', column: 'unknown' };
  }

  /**
   * Format log message according to specification
   */
  formatMessage(level, message, element = null, tagNumber = null) {
    const timestamp = this.formatTimestamp();
    const { line, column } = this.getStackInfo();
    
    let formattedMessage = `[${timestamp}] ${this.context}`;
    
    if (element) {
      formattedMessage += ` <${element}>`;
    }
    
    if (tagNumber) {
      formattedMessage += ` tag #${tagNumber}`;
    }
    
    formattedMessage += `: ${message} at line ${line}, column ${column}`;
    
    return formattedMessage;
  }

  /**
   * Check if a log level should be output
   */
  shouldLog(level) {
    const levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
    
    return levels[level] <= levels[this.logLevel];
  }

  /**
   * Log an error message
   */
  error(message, error = null, element = null, tagNumber = null) {
    if (!this.shouldLog('error')) return;
    
    const formattedMessage = this.formatMessage('ERROR', message, element, tagNumber);
    console.error(formattedMessage);
    
    if (error) {
      console.error('Error details:', error);
      if (error.stack) {
        console.error('Stack trace:', error.stack);
      }
    }
  }

  /**
   * Log a warning message
   */
  warn(message, element = null, tagNumber = null) {
    if (!this.shouldLog('warn')) return;
    
    const formattedMessage = this.formatMessage('WARN', message, element, tagNumber);
    console.warn(formattedMessage);
  }

  /**
   * Log an info message
   */
  info(message, element = null, tagNumber = null) {
    if (!this.shouldLog('info')) return;
    
    const formattedMessage = this.formatMessage('INFO', message, element, tagNumber);
    console.info(formattedMessage);
  }

  /**
   * Log a debug message
   */
  debug(message, element = null, tagNumber = null) {
    if (!this.shouldLog('debug')) return;
    
    const formattedMessage = this.formatMessage('DEBUG', message, element, tagNumber);
    console.debug(formattedMessage);
  }

  /**
   * Log performance timing
   */
  time(label) {
    console.time(`${this.context}: ${label}`);
  }

  /**
   * End performance timing
   */
  timeEnd(label) {
    console.timeEnd(`${this.context}: ${label}`);
  }

  /**
   * Group related log messages
   */
  group(label) {
    console.group(`${this.context}: ${label}`);
  }

  /**
   * End log group
   */
  groupEnd() {
    console.groupEnd();
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext) {
    return new Logger(`${this.context}:${additionalContext}`);
  }

  /**
   * Log with custom level
   */
  log(level, message, element = null, tagNumber = null) {
    switch (level.toLowerCase()) {
      case 'error':
        this.error(message, null, element, tagNumber);
        break;
      case 'warn':
        this.warn(message, element, tagNumber);
        break;
      case 'info':
        this.info(message, element, tagNumber);
        break;
      case 'debug':
        this.debug(message, element, tagNumber);
        break;
      default:
        this.info(message, element, tagNumber);
    }
  }
}
