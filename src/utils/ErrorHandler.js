/**
 * ErrorHandler utility for consistent error handling and user feedback
 */

'use strict';

import { Logger } from './Logger.js';

export class ErrorHandler {
  constructor() {
    this.logger = new Logger('ErrorHandler');
    this.toastContainer = null;
    this.initializeToastContainer();
  }

  /**
   * Initialize the toast container for error notifications
   */
  initializeToastContainer() {
    // Use existing toast or create one
    this.toastContainer = document.getElementById('error-toast');
    if (!this.toastContainer) {
      this.createToastContainer();
    }
  }

  /**
   * Create toast container if it doesn't exist
   */
  createToastContainer() {
    this.toastContainer = document.createElement('div');
    this.toastContainer.id = 'error-toast';
    this.toastContainer.className = 'toast';
    this.toastContainer.hidden = true;
    this.toastContainer.innerHTML = `
      <div class="toast-content">
        <span class="toast-icon">⚠️</span>
        <span class="toast-message" id="toast-message"></span>
        <button type="button" class="toast-close" aria-label="Close notification">✕</button>
      </div>
    `;
    
    document.body.appendChild(this.toastContainer);
    
    // Add close functionality
    const closeBtn = this.toastContainer.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.hideToast());
  }

  /**
   * Handle different types of errors with appropriate user feedback
   */
  handleError(error, context = 'Unknown error', options = {}) {
    const {
      showToast = true,
      logLevel = 'error',
      userMessage = null,
      retryable = false,
      element = null,
      tagNumber = null
    } = options;

    // Log the error
    this.logger.log(logLevel, `${context}: ${error.message || error}`, element, tagNumber);
    
    if (error.stack) {
      this.logger.debug('Stack trace:', null, null, null);
      console.debug(error.stack);
    }

    // Determine user-friendly message
    const displayMessage = userMessage || this.getUserFriendlyMessage(error, context);

    // Show toast notification if requested
    if (showToast) {
      this.showToast(displayMessage, {
        type: this.getErrorType(error),
        retryable
      });
    }

    // Track error for analytics (if implemented)
    this.trackError(error, context);

    return {
      error,
      context,
      userMessage: displayMessage,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get user-friendly error message based on error type
   */
  getUserFriendlyMessage(error, context) {
    // Network errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return 'Network connection failed. Please check your internet connection and try again.';
    }

    if (error.name === 'AbortError') {
      return 'Request was cancelled. Please try again.';
    }

    // File handling errors
    if (context.includes('file') || context.includes('document')) {
      if (error.message.includes('size')) {
        return 'File is too large. Please select a smaller file.';
      }
      if (error.message.includes('type') || error.message.includes('format')) {
        return 'Unsupported file format. Please select a supported document type.';
      }
      return 'Failed to process the file. Please try a different file.';
    }

    // Storage errors
    if (error.name === 'QuotaExceededError') {
      return 'Storage quota exceeded. Please clear some data and try again.';
    }

    // URL validation errors
    if (context.includes('URL') || context.includes('validation')) {
      return 'Failed to validate URL. Please check the URL format and try again.';
    }

    // Search errors
    if (context.includes('search')) {
      return 'Search service is temporarily unavailable. Please try again later.';
    }

    // Generic fallback
    return 'An unexpected error occurred. Please try again or contact support if the problem persists.';
  }

  /**
   * Determine error type for styling
   */
  getErrorType(error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return 'network';
    }
    if (error.name === 'QuotaExceededError') {
      return 'storage';
    }
    if (error.name === 'AbortError') {
      return 'cancelled';
    }
    return 'error';
  }

  /**
   * Show toast notification
   */
  showToast(message, options = {}) {
    const { type = 'error', duration = 5000, retryable = false } = options;

    if (!this.toastContainer) {
      this.initializeToastContainer();
    }

    const messageElement = this.toastContainer.querySelector('#toast-message');
    const iconElement = this.toastContainer.querySelector('.toast-icon');

    // Set message
    messageElement.textContent = message;

    // Set icon based on type
    const icons = {
      error: '⚠️',
      warning: '⚠️',
      network: '🌐',
      storage: '💾',
      cancelled: '⏹️'
    };
    iconElement.textContent = icons[type] || icons.error;

    // Update toast class for styling
    this.toastContainer.className = `toast toast-${type}`;
    this.toastContainer.hidden = false;

    // Auto-hide after duration
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }

    this.toastTimeout = setTimeout(() => {
      this.hideToast();
    }, duration);

    // Add retry button if retryable
    if (retryable && !this.toastContainer.querySelector('.toast-retry')) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'toast-retry';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => {
        this.hideToast();
        // Emit retry event
        window.dispatchEvent(new CustomEvent('error:retry', {
          detail: { message, type }
        }));
      });
      
      this.toastContainer.querySelector('.toast-content').insertBefore(
        retryBtn,
        this.toastContainer.querySelector('.toast-close')
      );
    }
  }

  /**
   * Hide toast notification
   */
  hideToast() {
    if (this.toastContainer) {
      this.toastContainer.hidden = true;
      
      // Remove retry button if it exists
      const retryBtn = this.toastContainer.querySelector('.toast-retry');
      if (retryBtn) {
        retryBtn.remove();
      }
    }

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
  }

  /**
   * Track error for analytics (placeholder for future implementation)
   */
  trackError(error, context) {
    // This could be extended to send error data to analytics service
    // For now, just store in session storage for debugging
    try {
      const errorData = {
        message: error.message || error.toString(),
        context,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href
      };

      const existingErrors = JSON.parse(sessionStorage.getItem('url-fixer-errors') || '[]');
      existingErrors.push(errorData);
      
      // Keep only last 10 errors
      if (existingErrors.length > 10) {
        existingErrors.splice(0, existingErrors.length - 10);
      }
      
      sessionStorage.setItem('url-fixer-errors', JSON.stringify(existingErrors));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Get stored error history for debugging
   */
  getErrorHistory() {
    try {
      return JSON.parse(sessionStorage.getItem('url-fixer-errors') || '[]');
    } catch {
      return [];
    }
  }

  /**
   * Clear error history
   */
  clearErrorHistory() {
    try {
      sessionStorage.removeItem('url-fixer-errors');
    } catch {
      // Ignore storage errors
    }
  }
}
