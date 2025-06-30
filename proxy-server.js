/**
 * Simple CORS proxy server for URL validation
 * This server allows the URL Fixer application to validate external URLs
 * without being blocked by CORS policies.
 */

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { URL } from 'url';

const app = express();
const PORT = process.env.PROXY_PORT || 3001;

// Enable CORS for all routes
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
      'POST /validate-urls'
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`CORS Proxy server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  GET  http://localhost:${PORT}/validate-url?url=<url>`);
  console.log(`  POST http://localhost:${PORT}/validate-urls`);
});

export default app;
