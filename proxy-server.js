/**
 * Simple CORS proxy server for URL validation
 * This server allows the URL Fixer application to validate external URLs
 * without being blocked by CORS policies.
 */

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { URL } from 'url';
import puppeteer from 'puppeteer';

const app = express();
const PORT = process.env.PROXY_PORT || 3001;

// Chrome Headless configuration
const CHROME_CONFIG = {
  headless: 'new', // Use new headless mode
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ],
  defaultViewport: {
    width: 1920,
    height: 1080
  },
  timeout: 30000
};

// Browser instance management
let browserInstance = null;
let browserPages = new Map(); // Track active pages
let lastBrowserActivity = Date.now();

// Browser cleanup interval (close browser if inactive for 5 minutes)
const BROWSER_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
setInterval(async () => {
  if (browserInstance && Date.now() - lastBrowserActivity > BROWSER_IDLE_TIMEOUT) {
    console.log('🔄 Closing idle browser instance...');
    await closeBrowser();
  }
}, 60000); // Check every minute

/**
 * Get or create browser instance
 */
async function getBrowser() {
  if (!browserInstance) {
    console.log('🚀 Launching Chrome Headless browser...');
    try {
      browserInstance = await puppeteer.launch(CHROME_CONFIG);
      console.log('✅ Chrome Headless browser launched successfully');
    } catch (error) {
      console.error('❌ Failed to launch Chrome Headless browser:', error.message);
      throw new Error(`Browser launch failed: ${error.message}`);
    }
  }
  lastBrowserActivity = Date.now();
  return browserInstance;
}

/**
 * Get a new page from the browser
 */
async function getPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Set up page with security and performance optimizations
  await page.setRequestInterception(true);

  // Block unnecessary resources to speed up loading
  page.on('request', (req) => {
    const resourceType = req.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  // Set timeouts
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);

  const pageId = Math.random().toString(36).substr(2, 9);
  browserPages.set(pageId, page);

  return { page, pageId };
}

/**
 * Close a specific page
 */
async function closePage(pageId) {
  const page = browserPages.get(pageId);
  if (page) {
    try {
      await page.close();
    } catch (error) {
      console.warn('Warning: Failed to close page:', error.message);
    }
    browserPages.delete(pageId);
  }
}

/**
 * Close browser instance
 */
async function closeBrowser() {
  if (browserInstance) {
    try {
      // Close all pages first
      for (const [pageId, page] of browserPages) {
        try {
          await page.close();
        } catch (error) {
          console.warn(`Warning: Failed to close page ${pageId}:`, error.message);
        }
      }
      browserPages.clear();

      // Close browser
      await browserInstance.close();
      browserInstance = null;
      console.log('✅ Browser instance closed');
    } catch (error) {
      console.error('❌ Error closing browser:', error.message);
      browserInstance = null; // Reset anyway
    }
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down proxy server...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Shutting down proxy server...');
  await closeBrowser();
  process.exit(0);
});

// Enable CORS for all routes
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  const browserStatus = browserInstance ? 'running' : 'stopped';
  const activePagesCount = browserPages.size;

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    browser: {
      status: browserStatus,
      activePages: activePagesCount,
      lastActivity: new Date(lastBrowserActivity).toISOString()
    }
  });
});

// Chrome Headless URL validation endpoint
app.get('/validate-url-headless', async (req, res) => {
  const { url, timeout = 30000, waitForSelector, screenshot = false } = req.query;

  if (!url) {
    return res.status(400).json({
      error: 'Missing url parameter',
      usage: '/validate-url-headless?url=https://example.com&timeout=30000&waitForSelector=.content&screenshot=false'
    });
  }

  let pageId = null;
  let page = null;

  try {
    // Validate URL format
    const targetUrl = new URL(url);

    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({
        error: 'Invalid protocol. Only HTTP and HTTPS are allowed.',
        protocol: targetUrl.protocol
      });
    }

    const startTime = Date.now();

    // Get a new page
    const pageResult = await getPage();
    page = pageResult.page;
    pageId = pageResult.pageId;

    try {
      // Navigate to the URL
      const response = await page.goto(url, {
        waitUntil: 'networkidle0',
        timeout: parseInt(timeout)
      });

      const responseTime = Date.now() - startTime;

      // Wait for specific selector if provided
      if (waitForSelector) {
        try {
          await page.waitForSelector(waitForSelector, { timeout: 5000 });
        } catch (selectorError) {
          console.warn(`Selector ${waitForSelector} not found within timeout`);
        }
      }

      // Get page info
      const title = await page.title();
      const finalUrl = page.url();

      // Take screenshot if requested
      let screenshotData = null;
      if (screenshot === 'true' || screenshot === true) {
        try {
          const screenshotBuffer = await page.screenshot({
            type: 'png',
            fullPage: false,
            clip: { x: 0, y: 0, width: 1200, height: 800 }
          });
          screenshotData = screenshotBuffer.toString('base64');
        } catch (screenshotError) {
          console.warn('Failed to take screenshot:', screenshotError.message);
        }
      }

      // Extract headers from the response
      const headers = response ? response.headers() : {};

      const result = {
        url: finalUrl,
        originalUrl: url,
        status: response ? response.status() : 200,
        statusText: response ? response.statusText() : 'OK',
        responseTime,
        headers,
        title,
        timestamp: new Date().toISOString(),
        method: 'HEADLESS_GET',
        redirected: finalUrl !== url
      };

      if (screenshotData) {
        result.screenshot = screenshotData;
      }

      res.json(result);

    } catch (navigationError) {
      const responseTime = Date.now() - startTime;

      let errorMessage = 'Navigation failed';
      let errorType = 'navigation';
      let status = 0;

      if (navigationError.name === 'TimeoutError') {
        errorMessage = `Navigation timeout after ${timeout}ms`;
        errorType = 'timeout';
      } else if (navigationError.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
        errorMessage = 'DNS resolution failed';
        errorType = 'dns';
      } else if (navigationError.message.includes('net::ERR_CONNECTION_REFUSED')) {
        errorMessage = 'Connection refused';
        errorType = 'connection';
      } else if (navigationError.message.includes('net::ERR_CERT_')) {
        errorMessage = 'SSL certificate error';
        errorType = 'ssl';
      } else if (navigationError.message.includes('net::ERR_INTERNET_DISCONNECTED')) {
        errorMessage = 'No internet connection';
        errorType = 'network';
      }

      res.json({
        url,
        status,
        statusText: errorMessage,
        responseTime,
        headers: {},
        timestamp: new Date().toISOString(),
        error: errorMessage,
        errorType,
        method: 'HEADLESS_GET'
      });
    }

  } catch (urlError) {
    res.status(400).json({
      error: 'Invalid URL format or browser error',
      details: urlError.message,
      url
    });
  } finally {
    // Always close the page
    if (pageId) {
      await closePage(pageId);
    }
  }
});

// URL validation proxy endpoint
app.get('/validate-url', async (req, res) => {
  const { url, method = 'HEAD', timeout = 10000 } = req.query;

  if (!url) {
    return res.status(400).json({
      error: 'Missing url parameter',
      usage: '/validate-url?url=https://example.com&method=HEAD&timeout=10000'
    });
  }

  try {
    // Validate URL format
    const targetUrl = new URL(url);
    
    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({
        error: 'Invalid protocol. Only HTTP and HTTPS are allowed.',
        protocol: targetUrl.protocol
      });
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), parseInt(timeout));

    try {
      const response = await fetch(url, {
        method: method.toUpperCase(),
        signal: controller.signal,
        headers: {
          'User-Agent': 'URL-Fixer-Proxy/1.0 (+https://url-fixer.app)',
          'Accept': '*/*',
          'Cache-Control': 'no-cache'
        },
        redirect: 'follow'
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      // Extract relevant headers
      const headers = {};
      const relevantHeaders = ['content-type', 'content-length', 'last-modified', 'etag', 'location'];
      relevantHeaders.forEach(header => {
        const value = response.headers.get(header);
        if (value) {
          headers[header] = value;
        }
      });

      res.json({
        url,
        status: response.status,
        statusText: response.statusText,
        responseTime,
        headers,
        timestamp: new Date().toISOString(),
        method: method.toUpperCase()
      });

    } catch (fetchError) {
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      let errorMessage = 'Network error';
      let errorType = 'network';

      if (fetchError.name === 'AbortError') {
        errorMessage = `Request timeout after ${timeout}ms`;
        errorType = 'timeout';
      } else if (fetchError.code === 'ENOTFOUND') {
        errorMessage = 'DNS resolution failed';
        errorType = 'dns';
      } else if (fetchError.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused';
        errorType = 'connection';
      } else if (fetchError.code === 'CERT_HAS_EXPIRED' || fetchError.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        errorMessage = 'SSL certificate error';
        errorType = 'ssl';
      }

      res.json({
        url,
        status: 0,
        statusText: errorMessage,
        responseTime,
        headers: {},
        timestamp: new Date().toISOString(),
        error: errorMessage,
        errorType,
        method: method.toUpperCase()
      });
    }

  } catch (urlError) {
    res.status(400).json({
      error: 'Invalid URL format',
      details: urlError.message,
      url
    });
  }
});

// Batch URL validation endpoint
app.post('/validate-urls', async (req, res) => {
  const { urls, method = 'HEAD', timeout = 10000, concurrency = 5 } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({
      error: 'Missing or invalid urls array in request body',
      usage: 'POST /validate-urls with body: { "urls": ["https://example.com"], "method": "HEAD", "timeout": 10000, "concurrency": 5 }'
    });
  }

  if (urls.length > 100) {
    return res.status(400).json({
      error: 'Too many URLs. Maximum 100 URLs per batch request.'
    });
  }

  try {
    const results = [];

    // Process URLs in batches to control concurrency
    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);

      const batchPromises = batch.map(async (url) => {
        try {
          const response = await fetch(`http://localhost:${PORT}/validate-url?url=${encodeURIComponent(url)}&method=${method}&timeout=${timeout}`);
          return await response.json();
        } catch (error) {
          return {
            url,
            status: 0,
            statusText: 'Proxy error',
            responseTime: 0,
            headers: {},
            timestamp: new Date().toISOString(),
            error: error.message,
            method: method.toUpperCase()
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    res.json({
      results,
      total: results.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// DuckDuckGo search proxy endpoint (instant answers)
app.get('/search', async (req, res) => {
  const { q: query, format = 'json', no_html = '1', skip_disambig = '1', timeout = 15000 } = req.query;

  if (!query) {
    return res.status(400).json({
      error: 'Missing query parameter',
      usage: '/search?q=search+terms&format=json'
    });
  }

  try {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), parseInt(timeout));

    // DuckDuckGo Instant Answer API
    const searchURL = new URL('https://api.duckduckgo.com/');
    searchURL.searchParams.set('q', query);
    searchURL.searchParams.set('format', format);
    searchURL.searchParams.set('no_html', no_html);
    searchURL.searchParams.set('skip_disambig', skip_disambig);

    try {
      const response = await fetch(searchURL.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'URL-Fixer-Proxy/1.0 (+https://url-fixer.app)',
          'Accept': 'application/json'
        }
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        return res.status(response.status).json({
          error: `Search API returned ${response.status}`,
          statusText: response.statusText,
          responseTime,
          timestamp: new Date().toISOString()
        });
      }

      const data = await response.json();

      res.json({
        ...data,
        responseTime,
        timestamp: new Date().toISOString(),
        query
      });

    } catch (fetchError) {
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      let errorMessage = 'Search request failed';
      if (fetchError.name === 'AbortError') {
        errorMessage = `Search timeout after ${timeout}ms`;
      }

      res.status(500).json({
        error: errorMessage,
        details: fetchError.message,
        responseTime,
        timestamp: new Date().toISOString(),
        query
      });
    }

  } catch (error) {
    res.status(500).json({
      error: 'Search proxy error',
      details: error.message,
      timestamp: new Date().toISOString(),
      query
    });
  }
});

// Google search proxy endpoint (HTML scraping)
app.get('/google-search', async (req, res) => {
  const { q: query, maxResults = 5, timeout = 15000 } = req.query;

  if (!query) {
    return res.status(400).json({
      error: 'Missing query parameter',
      usage: '/google-search?q=search+terms&maxResults=5'
    });
  }

  try {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), parseInt(timeout));

    // Google search (for actual web results)
    const searchURL = new URL('https://www.google.com/search');
    searchURL.searchParams.set('q', query);
    searchURL.searchParams.set('num', Math.min(parseInt(maxResults), 10).toString());

    try {
      const response = await fetch(searchURL.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        }
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        return res.status(response.status).json({
          error: `Google search returned ${response.status}`,
          statusText: response.statusText,
          responseTime,
          timestamp: new Date().toISOString(),
          query
        });
      }

      const html = await response.text();

      // Parse HTML to extract search results
      const results = parseGoogleSearchResults(html, parseInt(maxResults));

      res.json({
        results,
        query,
        resultCount: results.length,
        responseTime,
        timestamp: new Date().toISOString()
      });

    } catch (fetchError) {
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      let errorMessage = 'Google search request failed';
      if (fetchError.name === 'AbortError') {
        errorMessage = `Google search timeout after ${timeout}ms`;
      }

      res.status(500).json({
        error: errorMessage,
        details: fetchError.message,
        responseTime,
        timestamp: new Date().toISOString(),
        query
      });
    }

  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
      timestamp: new Date().toISOString(),
      query
    });
  }
});

// Chrome Headless web search endpoint
app.get('/web-search-headless', async (req, res) => {
  const { q: query, maxResults = 5, timeout = 30000, engine = 'duckduckgo' } = req.query;

  if (!query) {
    return res.status(400).json({
      error: 'Missing query parameter',
      usage: '/web-search-headless?q=search+terms&maxResults=5&engine=duckduckgo'
    });
  }

  let pageId = null;
  let page = null;

  try {
    const startTime = Date.now();

    // Get a new page
    const pageResult = await getPage();
    page = pageResult.page;
    pageId = pageResult.pageId;

    let searchURL;
    let resultSelector;
    let linkSelector;
    let titleSelector;
    let snippetSelector;

    // Configure search engine
    switch (engine.toLowerCase()) {
      case 'google':
        searchURL = new URL('https://www.google.com/search');
        searchURL.searchParams.set('q', query);
        searchURL.searchParams.set('num', Math.min(parseInt(maxResults), 10).toString());
        resultSelector = 'div.g';
        linkSelector = 'h3 a';
        titleSelector = 'h3';
        snippetSelector = '.VwiC3b, .s3v9rd';
        break;
      case 'bing':
        searchURL = new URL('https://www.bing.com/search');
        searchURL.searchParams.set('q', query);
        resultSelector = '.b_algo';
        linkSelector = 'h2 a';
        titleSelector = 'h2';
        snippetSelector = '.b_caption p';
        break;
      case 'duckduckgo':
      default:
        searchURL = new URL('https://html.duckduckgo.com/html/');
        searchURL.searchParams.set('q', query);
        resultSelector = '.result';
        linkSelector = '.result__a';
        titleSelector = '.result__a';
        snippetSelector = '.result__snippet';
        break;
    }

    try {
      // Navigate to search page
      await page.goto(searchURL.toString(), {
        waitUntil: 'networkidle0',
        timeout: parseInt(timeout)
      });

      // Wait for search results to load
      await page.waitForSelector(resultSelector, { timeout: 10000 });

      // Extract search results
      const results = await page.evaluate((config) => {
        const { resultSelector, linkSelector, titleSelector, snippetSelector, maxResults } = config;
        const resultElements = document.querySelectorAll(resultSelector);
        const extractedResults = [];

        for (let i = 0; i < Math.min(resultElements.length, maxResults); i++) {
          const resultElement = resultElements[i];

          try {
            const linkElement = resultElement.querySelector(linkSelector);
            const titleElement = resultElement.querySelector(titleSelector);
            const snippetElement = resultElement.querySelector(snippetSelector);

            if (linkElement && titleElement) {
              let url = linkElement.href;
              const title = titleElement.textContent?.trim() || 'No title';
              const snippet = snippetElement?.textContent?.trim() || '';

              // Clean up URL (remove tracking parameters for Google)
              if (url.includes('google.com') && url.includes('/url?')) {
                const urlParams = new URLSearchParams(url.split('?')[1]);
                url = urlParams.get('url') || url;
              }

              // Skip internal search engine URLs
              if (url && !url.includes('google.com') && !url.includes('bing.com') &&
                  !url.includes('duckduckgo.com') && url.startsWith('http')) {
                extractedResults.push({
                  url: decodeURIComponent(url),
                  title,
                  snippet,
                  source: config.engine
                });
              }
            }
          } catch (error) {
            console.warn('Failed to extract result:', error.message);
          }
        }

        return extractedResults;
      }, { resultSelector, linkSelector, titleSelector, snippetSelector, maxResults: parseInt(maxResults), engine });

      const responseTime = Date.now() - startTime;

      res.json({
        results,
        query,
        engine,
        resultCount: results.length,
        responseTime,
        timestamp: new Date().toISOString(),
        method: 'HEADLESS_SEARCH'
      });

    } catch (searchError) {
      const responseTime = Date.now() - startTime;

      let errorMessage = 'Search request failed';
      if (searchError.name === 'TimeoutError') {
        errorMessage = `Search timeout after ${timeout}ms`;
      }

      res.status(500).json({
        error: errorMessage,
        details: searchError.message,
        responseTime,
        timestamp: new Date().toISOString(),
        query,
        engine,
        method: 'HEADLESS_SEARCH'
      });
    }

  } catch (error) {
    res.status(500).json({
      error: 'Headless search error',
      details: error.message,
      timestamp: new Date().toISOString(),
      query,
      engine
    });
  } finally {
    // Always close the page
    if (pageId) {
      await closePage(pageId);
    }
  }
});

// Web search proxy endpoint (HTML scraping for actual search results)
app.get('/web-search', async (req, res) => {
  const { q: query, maxResults = 5, timeout = 15000 } = req.query;

  if (!query) {
    return res.status(400).json({
      error: 'Missing query parameter',
      usage: '/web-search?q=search+terms&maxResults=5'
    });
  }

  try {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), parseInt(timeout));

    // DuckDuckGo HTML search (for actual web results)
    const searchURL = new URL('https://html.duckduckgo.com/html/');
    searchURL.searchParams.set('q', query);

    try {
      const response = await fetch(searchURL.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        }
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        return res.status(response.status).json({
          error: `Web search returned ${response.status}`,
          statusText: response.statusText,
          responseTime,
          timestamp: new Date().toISOString()
        });
      }

      const html = await response.text();

      // Debug: log first 1000 characters of HTML
      console.log('DuckDuckGo HTML sample:', html.substring(0, 1000));

      // Parse HTML to extract search results
      const results = parseSearchResults(html, parseInt(maxResults));

      res.json({
        results,
        query,
        resultCount: results.length,
        responseTime,
        timestamp: new Date().toISOString()
      });

    } catch (fetchError) {
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      let errorMessage = 'Web search request failed';
      if (fetchError.name === 'AbortError') {
        errorMessage = `Web search timeout after ${timeout}ms`;
      }

      res.status(500).json({
        error: errorMessage,
        details: fetchError.message,
        responseTime,
        timestamp: new Date().toISOString(),
        query
      });
    }

  } catch (error) {
    res.status(500).json({
      error: 'Web search proxy error',
      details: error.message,
      timestamp: new Date().toISOString(),
      query
    });
  }
});

// Chrome Headless content scraping endpoint
app.get('/scrape-content', async (req, res) => {
  const { url, timeout = 30000, waitForSelector, extractText = true, extractLinks = false, extractImages = false } = req.query;

  if (!url) {
    return res.status(400).json({
      error: 'Missing url parameter',
      usage: '/scrape-content?url=https://example.com&extractText=true&extractLinks=false&extractImages=false'
    });
  }

  let pageId = null;
  let page = null;

  try {
    // Validate URL format
    const targetUrl = new URL(url);

    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({
        error: 'Invalid protocol. Only HTTP and HTTPS are allowed.',
        protocol: targetUrl.protocol
      });
    }

    const startTime = Date.now();

    // Get a new page
    const pageResult = await getPage();
    page = pageResult.page;
    pageId = pageResult.pageId;

    try {
      // Navigate to the URL
      const response = await page.goto(url, {
        waitUntil: 'networkidle0',
        timeout: parseInt(timeout)
      });

      // Wait for specific selector if provided
      if (waitForSelector) {
        try {
          await page.waitForSelector(waitForSelector, { timeout: 10000 });
        } catch (selectorError) {
          console.warn(`Selector ${waitForSelector} not found within timeout`);
        }
      }

      // Extract content based on options
      const content = await page.evaluate((options) => {
        const result = {
          title: document.title,
          url: window.location.href,
          meta: {}
        };

        // Extract meta tags
        const metaTags = document.querySelectorAll('meta');
        metaTags.forEach(meta => {
          const name = meta.getAttribute('name') || meta.getAttribute('property');
          const content = meta.getAttribute('content');
          if (name && content) {
            result.meta[name] = content;
          }
        });

        // Extract text content
        if (options.extractText) {
          // Remove script and style elements
          const scripts = document.querySelectorAll('script, style, noscript');
          scripts.forEach(el => el.remove());

          // Get main content areas
          const contentSelectors = [
            'main', 'article', '.content', '#content', '.post', '.entry',
            '.article-body', '.post-content', '.entry-content'
          ];

          let mainContent = '';
          for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              mainContent = element.innerText?.trim() || '';
              break;
            }
          }

          // Fallback to body if no main content found
          if (!mainContent) {
            mainContent = document.body?.innerText?.trim() || '';
          }

          result.text = mainContent.substring(0, 10000); // Limit to 10KB
          result.textLength = mainContent.length;
        }

        // Extract links
        if (options.extractLinks) {
          const links = Array.from(document.querySelectorAll('a[href]')).map(link => ({
            url: link.href,
            text: link.textContent?.trim() || '',
            title: link.getAttribute('title') || ''
          })).filter(link => link.url.startsWith('http'));

          result.links = links.slice(0, 100); // Limit to 100 links
          result.linkCount = links.length;
        }

        // Extract images
        if (options.extractImages) {
          const images = Array.from(document.querySelectorAll('img[src]')).map(img => ({
            url: img.src,
            alt: img.getAttribute('alt') || '',
            title: img.getAttribute('title') || ''
          })).filter(img => img.url.startsWith('http'));

          result.images = images.slice(0, 50); // Limit to 50 images
          result.imageCount = images.length;
        }

        return result;
      }, {
        extractText: extractText === 'true',
        extractLinks: extractLinks === 'true',
        extractImages: extractImages === 'true'
      });

      const responseTime = Date.now() - startTime;

      res.json({
        ...content,
        status: response ? response.status() : 200,
        statusText: response ? response.statusText() : 'OK',
        responseTime,
        timestamp: new Date().toISOString(),
        method: 'HEADLESS_SCRAPE'
      });

    } catch (navigationError) {
      const responseTime = Date.now() - startTime;

      let errorMessage = 'Content scraping failed';
      let errorType = 'scraping';

      if (navigationError.name === 'TimeoutError') {
        errorMessage = `Scraping timeout after ${timeout}ms`;
        errorType = 'timeout';
      }

      res.json({
        url,
        status: 0,
        statusText: errorMessage,
        responseTime,
        timestamp: new Date().toISOString(),
        error: errorMessage,
        errorType,
        method: 'HEADLESS_SCRAPE'
      });
    }

  } catch (urlError) {
    res.status(400).json({
      error: 'Invalid URL format or browser error',
      details: urlError.message,
      url
    });
  } finally {
    // Always close the page
    if (pageId) {
      await closePage(pageId);
    }
  }
});

// Simple HTML parser for Google search results
function parseGoogleSearchResults(html, maxResults) {
  const results = [];

  try {
    // Google search results parsing
    // Look for result containers with standard Google result format
    const resultRegex = /<div[^>]*class="[^"]*g[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*><h3[^>]*>([^<]+)<\/h3><\/a>[\s\S]*?<span[^>]*>([^<]*)<\/span>/gi;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      try {
        const url = match[1];
        const title = match[2].trim();
        const snippet = match[3].trim();

        // Skip Google's internal URLs and ensure it's a valid HTTP URL
        if (url && !url.startsWith('/') && !url.includes('google.com') && url.startsWith('http')) {
          results.push({
            url: url,
            title: title || 'No title',
            snippet: snippet || '',
            source: 'google'
          });
        }
      } catch (error) {
        console.warn('Failed to parse Google search result:', error.message);
      }
    }

    // Fallback: simpler regex for basic link extraction if no results found
    if (results.length === 0) {
      const simpleLinkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*><h3[^>]*>([^<]+)<\/h3>/gi;
      while ((match = simpleLinkRegex.exec(html)) !== null && results.length < maxResults) {
        try {
          const url = match[1];
          const title = match[2].trim();

          if (!url.includes('google.com')) {
            results.push({
              url: url,
              title: title || 'No title',
              snippet: '',
              source: 'google'
            });
          }
        } catch (error) {
          console.warn('Failed to parse simple Google result:', error.message);
        }
      }
    }

    console.log(`Parsed ${results.length} results from Google HTML`);
    return results;

  } catch (error) {
    console.error('Error parsing Google search results:', error);
    return [];
  }
}

// Simple HTML parser for DuckDuckGo search results
function parseSearchResults(html, maxResults) {
  const results = [];

  try {
    // Simple regex-based parsing (not ideal but works for basic cases)
    // Look for result links in DuckDuckGo HTML format
    const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetRegex = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([^<]+)<\/a>/gi;

    let match;
    let count = 0;

    while ((match = linkRegex.exec(html)) !== null && count < maxResults) {
      const url = decodeURIComponent(match[1]);
      const title = match[2].trim();

      // Skip DuckDuckGo internal URLs
      if (url.startsWith('/') || url.includes('duckduckgo.com')) {
        continue;
      }

      results.push({
        url: url,
        title: title,
        snippet: '', // Could extract snippets with more complex parsing
        source: 'duckduckgo-html'
      });

      count++;
    }

    // If no results found with the above method, try a simpler approach
    if (results.length === 0) {
      const simpleRegex = /href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
      while ((match = simpleRegex.exec(html)) !== null && count < maxResults) {
        const url = decodeURIComponent(match[1]);
        const title = match[2].trim();

        // Filter for actual URLs and skip internal links
        if (url.startsWith('http') && !url.includes('duckduckgo.com') && title.length > 5) {
          results.push({
            url: url,
            title: title,
            snippet: '',
            source: 'duckduckgo-html-simple'
          });
          count++;
        }
      }
    }

  } catch (error) {
    console.error('Error parsing search results:', error);
  }

  return results;
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Proxy server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'GET /validate-url?url=<url>&method=<HEAD|GET>&timeout=<ms>',
      'GET /validate-url-headless?url=<url>&timeout=<ms>&screenshot=<true|false>',
      'POST /validate-urls',
      'GET /search?q=<query>&format=json',
      'GET /web-search?q=<query>&maxResults=5',
      'GET /web-search-headless?q=<query>&maxResults=5&engine=<google|bing|duckduckgo>',
      'GET /google-search?q=<query>&maxResults=5',
      'GET /scrape-content?url=<url>&extractText=<true|false>&extractLinks=<true|false>'
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 CORS Proxy server with Chrome Headless running on http://localhost:${PORT}`);
  console.log('📋 Available endpoints:');
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  GET  http://localhost:${PORT}/validate-url?url=<url>`);
  console.log(`  GET  http://localhost:${PORT}/validate-url-headless?url=<url>&screenshot=<true|false>`);
  console.log(`  POST http://localhost:${PORT}/validate-urls`);
  console.log(`  GET  http://localhost:${PORT}/search?q=<query>`);
  console.log(`  GET  http://localhost:${PORT}/web-search?q=<query>`);
  console.log(`  GET  http://localhost:${PORT}/web-search-headless?q=<query>&engine=<google|bing|duckduckgo>`);
  console.log(`  GET  http://localhost:${PORT}/google-search?q=<query>`);
  console.log(`  GET  http://localhost:${PORT}/scrape-content?url=<url>&extractText=true`);
  console.log('');
  console.log('🔧 Chrome Headless features:');
  console.log('  • CORS-free URL validation and content scraping');
  console.log('  • JavaScript-rendered page support');
  console.log('  • Screenshot capture capability');
  console.log('  • Enhanced search result extraction');
  console.log('  • Automatic browser management');
});

export default app;
