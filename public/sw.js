/**
 * Service Worker for URL Fixer PWA
 * Provides offline support, caching strategies, and background sync
 */

'use strict';

const CACHE_NAME = 'url-fixer-v1';
const STATIC_CACHE_NAME = 'url-fixer-static-v1';
const DYNAMIC_CACHE_NAME = 'url-fixer-dynamic-v1';

// Files to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/src/main.js',
  '/src/styles/main.css',
  '/README.md'
];

// Cache strategies
const CACHE_STRATEGIES = {
  CACHE_FIRST: 'cache-first',
  NETWORK_FIRST: 'network-first',
  STALE_WHILE_REVALIDATE: 'stale-while-revalidate',
  NETWORK_ONLY: 'network-only',
  CACHE_ONLY: 'cache-only'
};

// Route configurations
const ROUTE_CONFIG = [
  {
    pattern: /\.(js|css|html)$/,
    strategy: CACHE_STRATEGIES.STALE_WHILE_REVALIDATE,
    cacheName: STATIC_CACHE_NAME
  },
  {
    pattern: /\.(png|jpg|jpeg|svg|gif|ico)$/,
    strategy: CACHE_STRATEGIES.CACHE_FIRST,
    cacheName: STATIC_CACHE_NAME
  },
  {
    pattern: /^https:\/\/api\.duckduckgo\.com/,
    strategy: CACHE_STRATEGIES.NETWORK_FIRST,
    cacheName: DYNAMIC_CACHE_NAME,
    maxAge: 3600000 // 1 hour
  },
  {
    pattern: /\/README\.md$/,
    strategy: CACHE_STRATEGIES.STALE_WHILE_REVALIDATE,
    cacheName: STATIC_CACHE_NAME
  }
];

/**
 * Install event - cache static assets
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
      })
  );
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        const deletePromises = cacheNames
          .filter((cacheName) => {
            return cacheName !== STATIC_CACHE_NAME && 
                   cacheName !== DYNAMIC_CACHE_NAME &&
                   cacheName.startsWith('url-fixer-');
          })
          .map((cacheName) => {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          });
        
        return Promise.all(deletePromises);
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim();
      })
      .catch((error) => {
        console.error('[SW] Activation failed:', error);
      })
  );
});

/**
 * Fetch event - handle network requests with caching strategies
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  // Find matching route configuration
  const routeConfig = findRouteConfig(request.url);
  
  if (routeConfig) {
    event.respondWith(
      handleRequest(request, routeConfig)
    );
  } else {
    // Default strategy for unmatched routes
    event.respondWith(
      handleRequest(request, {
        strategy: CACHE_STRATEGIES.NETWORK_FIRST,
        cacheName: DYNAMIC_CACHE_NAME
      })
    );
  }
});

/**
 * Find route configuration for a URL
 */
function findRouteConfig(url) {
  return ROUTE_CONFIG.find(config => config.pattern.test(url));
}

/**
 * Handle request based on caching strategy
 */
async function handleRequest(request, config) {
  const { strategy, cacheName, maxAge } = config;
  
  try {
    switch (strategy) {
      case CACHE_STRATEGIES.CACHE_FIRST:
        return await cacheFirst(request, cacheName);
      
      case CACHE_STRATEGIES.NETWORK_FIRST:
        return await networkFirst(request, cacheName, maxAge);
      
      case CACHE_STRATEGIES.STALE_WHILE_REVALIDATE:
        return await staleWhileRevalidate(request, cacheName);
      
      case CACHE_STRATEGIES.NETWORK_ONLY:
        return await fetch(request);
      
      case CACHE_STRATEGIES.CACHE_ONLY:
        return await cacheOnly(request, cacheName);
      
      default:
        return await networkFirst(request, cacheName);
    }
  } catch (error) {
    console.error('[SW] Request handling failed:', error);
    return await handleOfflineFallback(request);
  }
}

/**
 * Cache First strategy
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  const networkResponse = await fetch(request);
  
  if (networkResponse.ok) {
    cache.put(request, networkResponse.clone());
  }
  
  return networkResponse;
}

/**
 * Network First strategy
 */
async function networkFirst(request, cacheName, maxAge) {
  const cache = await caches.open(cacheName);
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Add timestamp for cache expiration
      const responseToCache = networkResponse.clone();
      if (maxAge) {
        responseToCache.headers.set('sw-cached-at', Date.now().toString());
        responseToCache.headers.set('sw-max-age', maxAge.toString());
      }
      cache.put(request, responseToCache);
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Check if cached response is expired
      if (maxAge && isCacheExpired(cachedResponse, maxAge)) {
        console.log('[SW] Cached response expired:', request.url);
        throw new Error('Cached response expired and network unavailable');
      }
      return cachedResponse;
    }
    
    throw error;
  }
}

/**
 * Stale While Revalidate strategy
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  // Start network request (don't await)
  const networkResponsePromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch((error) => {
      console.log('[SW] Background fetch failed:', error);
    });
  
  // Return cached response immediately if available
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // If no cache, wait for network
  return await networkResponsePromise;
}

/**
 * Cache Only strategy
 */
async function cacheOnly(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (!cachedResponse) {
    throw new Error('No cached response available');
  }
  
  return cachedResponse;
}

/**
 * Check if cached response is expired
 */
function isCacheExpired(response, maxAge) {
  const cachedAt = response.headers.get('sw-cached-at');
  const cacheMaxAge = response.headers.get('sw-max-age');
  
  if (!cachedAt || !cacheMaxAge) {
    return false;
  }
  
  const age = Date.now() - parseInt(cachedAt);
  return age > parseInt(cacheMaxAge);
}

/**
 * Handle offline fallback
 */
async function handleOfflineFallback(request) {
  const url = new URL(request.url);
  
  // For navigation requests, return cached index.html
  if (request.mode === 'navigate') {
    const cache = await caches.open(STATIC_CACHE_NAME);
    const cachedIndex = await cache.match('/index.html');
    
    if (cachedIndex) {
      return cachedIndex;
    }
  }
  
  // For other requests, return a generic offline response
  return new Response(
    JSON.stringify({
      error: 'Offline',
      message: 'This request requires an internet connection'
    }),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
}

/**
 * Background sync for failed requests
 */
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'url-validation-retry') {
    event.waitUntil(retryFailedValidations());
  }
});

/**
 * Retry failed URL validations
 */
async function retryFailedValidations() {
  try {
    // This would integrate with IndexedDB to retry failed validations
    console.log('[SW] Retrying failed URL validations');
    
    // Implementation would:
    // 1. Get failed validations from IndexedDB
    // 2. Retry them
    // 3. Update results in IndexedDB
    // 4. Notify the main app
    
  } catch (error) {
    console.error('[SW] Failed to retry validations:', error);
  }
}

/**
 * Handle push notifications (future feature)
 */
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  const options = {
    body: 'URL validation completed',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: 'url-fixer-notification',
    requireInteraction: false
  };
  
  event.waitUntil(
    self.registration.showNotification('URL Fixer', options)
  );
});

/**
 * Handle notification clicks
 */
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});

/**
 * Message handling for communication with main app
 */
self.addEventListener('message', (event) => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'GET_VERSION':
      event.ports[0].postMessage({ version: CACHE_NAME });
      break;
      
    case 'CLEAR_CACHE':
      clearAllCaches().then(() => {
        event.ports[0].postMessage({ success: true });
      });
      break;
      
    default:
      console.log('[SW] Unknown message type:', type);
  }
});

/**
 * Clear all caches
 */
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  const deletePromises = cacheNames
    .filter(name => name.startsWith('url-fixer-'))
    .map(name => caches.delete(name));
  
  return Promise.all(deletePromises);
}
