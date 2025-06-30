/**
 * Simple test script to verify the CORS proxy is working
 */

import fetch from 'node-fetch';

const PROXY_URL = 'http://localhost:3001';
const TEST_URLS = [
    'https://www.google.com',
    'https://en.wikipedia.org/wiki/CORS',
    'https://httpbin.org/status/200'
];

async function testProxyHealth() {
    console.log('🔍 Testing proxy health...');
    try {
        const response = await fetch(`${PROXY_URL}/health`);
        const data = await response.json();
        console.log('✅ Proxy health check passed:', data);
        return true;
    } catch (error) {
        console.error('❌ Proxy health check failed:', error.message);
        return false;
    }
}

async function testUrlValidation(url) {
    console.log(`🔍 Testing URL validation for: ${url}`);
    try {
        const proxyUrl = `${PROXY_URL}/validate-url?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        const data = await response.json();
        
        if (data.status > 0) {
            console.log(`✅ URL validation successful: ${url} -> ${data.status} ${data.statusText}`);
        } else {
            console.log(`⚠️  URL validation returned error: ${url} -> ${data.error || 'Unknown error'}`);
        }
        return data;
    } catch (error) {
        console.error(`❌ URL validation failed for ${url}:`, error.message);
        return null;
    }
}

async function testBatchValidation() {
    console.log('🔍 Testing batch URL validation...');
    try {
        const response = await fetch(`${PROXY_URL}/validate-urls`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                urls: TEST_URLS,
                method: 'HEAD',
                timeout: 10000,
                concurrency: 3
            })
        });
        
        const data = await response.json();
        console.log('✅ Batch validation successful:', data);
        return data;
    } catch (error) {
        console.error('❌ Batch validation failed:', error.message);
        return null;
    }
}

async function runTests() {
    console.log('🚀 Starting CORS proxy tests...\n');
    
    // Test 1: Health check
    const healthOk = await testProxyHealth();
    if (!healthOk) {
        console.log('❌ Proxy server is not available. Make sure it\'s running on port 3001.');
        process.exit(1);
    }
    
    console.log('');
    
    // Test 2: Individual URL validation
    for (const url of TEST_URLS) {
        await testUrlValidation(url);
    }
    
    console.log('');
    
    // Test 3: Batch validation
    await testBatchValidation();
    
    console.log('\n🎉 All tests completed!');
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runTests().catch(error => {
        console.error('❌ Test execution failed:', error);
        process.exit(1);
    });
}
