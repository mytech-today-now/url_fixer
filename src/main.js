/**
 * URL Fixer - Main Application Entry Point
 * 
 * This is the main entry point for the URL Fixer application.
 * It initializes the MVC architecture and sets up the application.
 * 
 * @version 1.0.0
 * @author URL Fixer Team
 */

'use strict';

// Import core modules
import { AppController } from './controllers/AppController.js';
import { DocumentModel } from './models/DocumentModel.js';
import { URLProcessorModel } from './models/URLProcessorModel.js';
import { AppView } from './views/AppView.js';
import { StorageService } from './services/StorageService.js';
import { URLValidationService } from './services/URLValidationService.js';
import { SearchService } from './services/SearchService.js';
import { DocumentParserService } from './services/DocumentParserService.js';
import { Logger } from './utils/Logger.js';
import { ErrorHandler } from './utils/ErrorHandler.js';
import { ServiceWorkerManager } from './utils/ServiceWorkerManager.js';

/**
 * Application class that orchestrates the entire URL Fixer application
 */
class URLFixerApp {
  constructor() {
    this.isInitialized = false;
    this.logger = new Logger('URLFixerApp');
    this.errorHandler = new ErrorHandler();
    this.serviceWorkerManager = new ServiceWorkerManager();

    // Initialize services
    this.services = {};
    this.models = {};
    this.views = {};
    this.controllers = {};
  }

  /**
   * Initialize the application
   */
  async init() {
    try {
      this.logger.info('Initializing URL Fixer application...');
      
      // Check for required browser features
      this.checkBrowserSupport();
      
      // Initialize services
      await this.initializeServices();
      
      // Initialize models
      this.initializeModels();
      
      // Initialize views
      this.initializeViews();
      
      // Initialize controllers
      await this.initializeControllers();
      
      // Set up global error handling
      this.setupErrorHandling();
      
      // Register service worker if supported
      await this.registerServiceWorker();
      
      this.isInitialized = true;
      this.logger.info('Application initialized successfully');
      
      // Dispatch application ready event
      window.dispatchEvent(new CustomEvent('app:ready', {
        detail: { app: this }
      }));
      
    } catch (error) {
      this.logger.error('Failed to initialize application:', error);
      this.errorHandler.handleError(error, 'Application initialization failed');
      throw error;
    }
  }

  /**
   * Check if the browser supports required features
   */
  checkBrowserSupport() {
    const requiredFeatures = [
      'fetch',
      'Promise',
      'localStorage',
      'indexedDB',
      'FileReader',
      'URL',
      'URLSearchParams'
    ];

    const missingFeatures = requiredFeatures.filter(feature => {
      return !(feature in window) && !(feature in window.constructor.prototype);
    });

    if (missingFeatures.length > 0) {
      throw new Error(`Browser missing required features: ${missingFeatures.join(', ')}`);
    }

    this.logger.info('Browser support check passed');
  }

  /**
   * Initialize all services
   */
  async initializeServices() {
    this.logger.info('Initializing services...');
    
    // Storage service
    this.services.storage = new StorageService();
    await this.services.storage.init();
    
    // URL validation service
    this.services.urlValidation = new URLValidationService();
    
    // Search service for finding replacement URLs
    this.services.search = new SearchService();
    
    // Document parser service
    this.services.documentParser = new DocumentParserService();
    
    this.logger.info('Services initialized');
  }

  /**
   * Initialize models
   */
  initializeModels() {
    this.logger.info('Initializing models...');
    
    // Document model for managing document state
    this.models.document = new DocumentModel(this.services.storage);
    
    // URL processor model for managing URL processing state
    this.models.urlProcessor = new URLProcessorModel(
      this.services.urlValidation,
      this.services.search,
      this.services.storage
    );
    
    this.logger.info('Models initialized');
  }

  /**
   * Initialize views
   */
  initializeViews() {
    this.logger.info('Initializing views...');
    
    // Main application view
    this.views.app = new AppView();
    
    this.logger.info('Views initialized');
  }

  /**
   * Initialize controllers
   */
  async initializeControllers() {
    this.logger.info('Initializing controllers...');

    // Main application controller
    this.controllers.app = new AppController(
      this.models,
      this.views,
      this.services
    );

    // Initialize the controller
    await this.controllers.app.init();

    this.logger.info('Controllers initialized');
  }

  /**
   * Set up global error handling
   */
  setupErrorHandling() {
    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.logger.error('Unhandled promise rejection:', event.reason);
      this.errorHandler.handleError(event.reason, 'Unhandled promise rejection');
      event.preventDefault();
    });

    // Handle uncaught errors
    window.addEventListener('error', (event) => {
      this.logger.error('Uncaught error:', event.error);
      this.errorHandler.handleError(event.error, 'Uncaught error');
    });

    this.logger.info('Global error handling set up');
  }

  /**
   * Register service worker for PWA features
   */
  async registerServiceWorker() {
    try {
      await this.serviceWorkerManager.register();

      // Set up service worker event listeners
      this.setupServiceWorkerListeners();

      // Set up install prompt handling
      this.serviceWorkerManager.setupInstallPrompt();

    } catch (error) {
      this.logger.warn('Service worker setup failed:', error);
    }
  }

  /**
   * Set up service worker event listeners
   */
  setupServiceWorkerListeners() {
    this.serviceWorkerManager.on('updateAvailable', () => {
      this.showUpdateNotification();
    });

    this.serviceWorkerManager.on('offline', () => {
      this.showOfflineNotification();
    });

    this.serviceWorkerManager.on('online', () => {
      this.hideOfflineNotification();
    });

    this.serviceWorkerManager.on('installPromptAvailable', () => {
      this.showInstallPrompt();
    });
  }

  /**
   * Show update notification
   */
  showUpdateNotification() {
    // This could show a toast or modal asking user to refresh
    this.logger.info('App update available');
  }

  /**
   * Show offline notification
   */
  showOfflineNotification() {
    // This could show an offline indicator
    this.logger.info('App is offline');
  }

  /**
   * Hide offline notification
   */
  hideOfflineNotification() {
    this.logger.info('App is back online');
  }

  /**
   * Show install prompt
   */
  showInstallPrompt() {
    // This could show an install button or banner
    this.logger.info('App can be installed');
  }

  /**
   * Get application instance
   */
  static getInstance() {
    if (!URLFixerApp.instance) {
      URLFixerApp.instance = new URLFixerApp();
    }
    return URLFixerApp.instance;
  }
}

/**
 * Initialize the application when DOM is ready
 */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const app = URLFixerApp.getInstance();
    await app.init();
  } catch (error) {
    console.error('Failed to start application:', error);
    
    // Show fallback error message to user
    const errorDiv = document.createElement('div');
    errorDiv.className = 'app-error';
    errorDiv.innerHTML = `
      <h2>Application Error</h2>
      <p>Failed to start the URL Fixer application. Please refresh the page and try again.</p>
      <details>
        <summary>Error Details</summary>
        <pre>${error.message}</pre>
      </details>
    `;
    document.body.appendChild(errorDiv);
  }
});

// Export for testing
export { URLFixerApp };
