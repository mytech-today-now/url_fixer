/**
 * ServiceWorkerManager - Manages service worker registration and communication
 * Handles PWA features, offline support, and cache management
 */

'use strict';

import { Logger } from './Logger.js';

export class ServiceWorkerManager {
  constructor() {
    this.logger = new Logger('ServiceWorkerManager');
    this.registration = null;
    this.isSupported = 'serviceWorker' in navigator;
    this.isOnline = navigator.onLine;
    this.listeners = new Map();
    
    // Set up online/offline detection
    this.setupOnlineDetection();
  }

  /**
   * Register the service worker
   */
  async register() {
    if (!this.isSupported) {
      this.logger.warn('Service Worker not supported in this browser');
      return null;
    }

    try {
      this.logger.info('Registering service worker');
      
      this.registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      this.logger.info('Service worker registered successfully');
      
      // Set up event listeners
      this.setupServiceWorkerListeners();
      
      // Check for updates
      this.checkForUpdates();
      
      this.emit('registered', this.registration);
      
      return this.registration;
      
    } catch (error) {
      this.logger.error('Service worker registration failed', error);
      this.emit('registrationFailed', error);
      throw error;
    }
  }

  /**
   * Set up service worker event listeners
   */
  setupServiceWorkerListeners() {
    if (!this.registration) return;

    // Listen for updates
    this.registration.addEventListener('updatefound', () => {
      this.logger.info('Service worker update found');
      
      const newWorker = this.registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            this.logger.info('New service worker installed, update available');
            this.emit('updateAvailable', newWorker);
          }
        });
      }
    });

    // Listen for messages from service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      this.handleServiceWorkerMessage(event.data);
    });

    // Listen for controller changes
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      this.logger.info('Service worker controller changed');
      this.emit('controllerChanged');
    });
  }

  /**
   * Handle messages from service worker
   */
  handleServiceWorkerMessage(data) {
    const { type, payload } = data;
    
    this.logger.debug('Message from service worker:', type, payload);
    
    switch (type) {
      case 'CACHE_UPDATED':
        this.emit('cacheUpdated', payload);
        break;
        
      case 'OFFLINE_FALLBACK':
        this.emit('offlineFallback', payload);
        break;
        
      case 'BACKGROUND_SYNC_SUCCESS':
        this.emit('backgroundSyncSuccess', payload);
        break;
        
      case 'BACKGROUND_SYNC_FAILED':
        this.emit('backgroundSyncFailed', payload);
        break;
        
      default:
        this.logger.debug('Unknown message type from service worker:', type);
    }
  }

  /**
   * Check for service worker updates
   */
  async checkForUpdates() {
    if (!this.registration) return;

    try {
      await this.registration.update();
      this.logger.debug('Checked for service worker updates');
    } catch (error) {
      this.logger.warn('Failed to check for updates', error);
    }
  }

  /**
   * Activate waiting service worker
   */
  async activateWaitingServiceWorker() {
    if (!this.registration || !this.registration.waiting) {
      return false;
    }

    try {
      this.logger.info('Activating waiting service worker');
      
      // Send skip waiting message
      this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      
      return true;
      
    } catch (error) {
      this.logger.error('Failed to activate waiting service worker', error);
      return false;
    }
  }

  /**
   * Send message to service worker
   */
  async sendMessage(type, data = {}) {
    if (!navigator.serviceWorker.controller) {
      this.logger.warn('No service worker controller available');
      return null;
    }

    return new Promise((resolve, reject) => {
      const messageChannel = new MessageChannel();
      
      messageChannel.port1.onmessage = (event) => {
        resolve(event.data);
      };
      
      messageChannel.port1.onerror = (error) => {
        reject(error);
      };
      
      navigator.serviceWorker.controller.postMessage(
        { type, data },
        [messageChannel.port2]
      );
      
      // Timeout after 5 seconds
      setTimeout(() => {
        reject(new Error('Service worker message timeout'));
      }, 5000);
    });
  }

  /**
   * Clear all caches
   */
  async clearCaches() {
    try {
      const result = await this.sendMessage('CLEAR_CACHE');
      this.logger.info('Caches cleared');
      this.emit('cachesCleared');
      return result;
    } catch (error) {
      this.logger.error('Failed to clear caches', error);
      throw error;
    }
  }

  /**
   * Get service worker version
   */
  async getVersion() {
    try {
      const result = await this.sendMessage('GET_VERSION');
      return result.version;
    } catch (error) {
      this.logger.warn('Failed to get service worker version', error);
      return null;
    }
  }

  /**
   * Set up online/offline detection
   */
  setupOnlineDetection() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.logger.info('Application is online');
      this.emit('online');
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.logger.info('Application is offline');
      this.emit('offline');
    });
  }

  /**
   * Request background sync for failed operations
   */
  async requestBackgroundSync(tag) {
    if (!this.registration || !this.registration.sync) {
      this.logger.warn('Background sync not supported');
      return false;
    }

    try {
      await this.registration.sync.register(tag);
      this.logger.info(`Background sync requested: ${tag}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to request background sync: ${tag}`, error);
      return false;
    }
  }

  /**
   * Show notification (if permission granted)
   */
  async showNotification(title, options = {}) {
    if (!this.registration) {
      this.logger.warn('No service worker registration for notifications');
      return false;
    }

    // Check notification permission
    if (Notification.permission !== 'granted') {
      this.logger.warn('Notification permission not granted');
      return false;
    }

    try {
      await this.registration.showNotification(title, {
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: 'url-fixer-notification',
        requireInteraction: false,
        ...options
      });
      
      return true;
    } catch (error) {
      this.logger.error('Failed to show notification', error);
      return false;
    }
  }

  /**
   * Request notification permission
   */
  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      this.logger.warn('Notifications not supported');
      return 'denied';
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    if (Notification.permission === 'denied') {
      return 'denied';
    }

    try {
      const permission = await Notification.requestPermission();
      this.logger.info(`Notification permission: ${permission}`);
      return permission;
    } catch (error) {
      this.logger.error('Failed to request notification permission', error);
      return 'denied';
    }
  }

  /**
   * Check if app can be installed (PWA)
   */
  canInstall() {
    return 'beforeinstallprompt' in window;
  }

  /**
   * Prompt user to install PWA
   */
  async promptInstall() {
    if (!this.installPromptEvent) {
      this.logger.warn('No install prompt available');
      return false;
    }

    try {
      this.installPromptEvent.prompt();
      const result = await this.installPromptEvent.userChoice;
      
      this.logger.info(`Install prompt result: ${result.outcome}`);
      this.installPromptEvent = null;
      
      return result.outcome === 'accepted';
    } catch (error) {
      this.logger.error('Failed to prompt install', error);
      return false;
    }
  }

  /**
   * Set up install prompt handling
   */
  setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.installPromptEvent = event;
      this.emit('installPromptAvailable');
    });

    window.addEventListener('appinstalled', () => {
      this.logger.info('PWA installed');
      this.installPromptEvent = null;
      this.emit('appInstalled');
    });
  }

  /**
   * Get installation status
   */
  getInstallationStatus() {
    return {
      isSupported: this.isSupported,
      isOnline: this.isOnline,
      canInstall: this.canInstall(),
      hasInstallPrompt: !!this.installPromptEvent,
      notificationPermission: 'Notification' in window ? Notification.permission : 'denied'
    };
  }

  /**
   * Event system
   */
  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  off(event, listener) {
    if (this.listeners.has(event)) {
      const listeners = this.listeners.get(event);
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          this.logger.error(`Error in service worker event listener for ${event}`, error);
        }
      });
    }
  }

  /**
   * Unregister service worker (for development/testing)
   */
  async unregister() {
    if (!this.registration) {
      return false;
    }

    try {
      const result = await this.registration.unregister();
      this.logger.info('Service worker unregistered');
      this.registration = null;
      return result;
    } catch (error) {
      this.logger.error('Failed to unregister service worker', error);
      return false;
    }
  }
}
