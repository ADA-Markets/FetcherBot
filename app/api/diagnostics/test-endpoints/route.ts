import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { WalletManager } from '@/lib/wallet/manager';
import { profileManager } from '@/lib/config/profile-manager';

interface TestResult {
  endpoint: string;
  method: string;
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
  responseData?: any;
  timestamp: string;
}

export async function POST(request: NextRequest) {
  // Get API base URL from active profile (per request, not at module load time)
  const profile = profileManager.getActiveProfile();
  const API_BASE = profile?.api?.baseUrl || 'https://mine.defensio.io/api';

  const results: TestResult[] = [];
  let walletManager: WalletManager | null = null;
  let testAddress: any = null;

  try {
    const { password, testAddressIndex } = await request.json();

    // Initialize wallet if password provided (for registration/submission tests)
    if (password) {
      try {
        walletManager = new WalletManager();
        const addresses = await walletManager.loadWallet(password);
        testAddress = addresses[testAddressIndex || 0];
      } catch (walletError: any) {
        results.push({
          endpoint: 'Wallet Initialization',
          method: 'LOCAL',
          success: false,
          error: `Failed to load wallet: ${walletError.message}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Test 1: Fetch Challenge
    const challengeTest = await testEndpoint(
      'GET /challenge',
      'GET',
      `${API_BASE}/challenge`,
      async () => {
        const response = await axios.get(`${API_BASE}/challenge`, { timeout: 10000 });
        return response;
      }
    );
    results.push(challengeTest);

    // Test 2: Test Solution Submission (connectivity test only - not a valid solution)
    if (walletManager && testAddress) {
      const submissionTest = await testEndpoint(
        'POST /solution',
        'POST',
        `${API_BASE}/solution/{address}/{challenge_id}/{nonce}`,
        async () => {
          // Use a mock nonce - this will likely fail but tests the endpoint
          const mockNonce = '0000000000000000000000000000000000000000000000000000000000000000';
          const challengeId = challengeTest.responseData?.challenge_id || 'test_challenge';

          const submitUrl = `${API_BASE}/solution/${testAddress.bech32}/${challengeId}/${mockNonce}`;
          const response = await axios.post(submitUrl, {}, {
            timeout: 10000,
            validateStatus: (status) => status < 600 // Accept any status to see the error
          });

          return response;
        },
        true // Mark as connectivity test - any response (even error) means endpoint is working
      );
      results.push(submissionTest);
    } else {
      results.push({
        endpoint: 'POST /solution',
        method: 'POST',
        success: false,
        error: 'Skipped: No password provided. Provide password to test solution submission.',
        timestamp: new Date().toISOString(),
      });
    }

    // Test 3: Network Latency Test
    const latencyTests: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      try {
        await axios.get(`${API_BASE}/challenge`, { timeout: 5000 });
        latencyTests.push(Date.now() - start);
      } catch (error) {
        latencyTests.push(-1);
      }
    }

    const avgLatency = latencyTests.filter(l => l > 0).reduce((a, b) => a + b, 0) / latencyTests.filter(l => l > 0).length;

    results.push({
      endpoint: 'Network Latency Test',
      method: 'DIAGNOSTIC',
      success: avgLatency > 0 && avgLatency < 5000,
      responseTime: avgLatency,
      responseData: {
        averageLatency: Math.round(avgLatency),
        samples: latencyTests,
        warning: avgLatency > 2000 ? 'High latency detected - network connection may be slow' : undefined
      },
      timestamp: new Date().toISOString(),
    });

    // Calculate overall health
    const successCount = results.filter(r => r.success).length;
    const totalCount = results.filter(r => !r.error?.includes('Skipped')).length;
    const healthPercentage = (successCount / totalCount) * 100;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: results.length,
        successful: successCount,
        failed: results.length - successCount,
        healthPercentage: Math.round(healthPercentage),
        apiBase: API_BASE,
      },
      results,
      diagnosticInfo: {
        walletLoaded: !!walletManager,
        testAddress: testAddress ? {
          index: testAddress.index,
          bech32: testAddress.bech32,
          registered: testAddress.registered
        } : null,
        averageLatency: avgLatency > 0 ? Math.round(avgLatency) : null,
      }
    });

  } catch (error: any) {
    console.error('[Diagnostics] Test error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Diagnostics test failed',
        results,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * Helper to test a single endpoint
 */
async function testEndpoint(
  name: string,
  method: string,
  endpoint: string,
  testFn: () => Promise<any>,
  isConnectivityTest: boolean = false
): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const response = await testFn();
    const responseTime = Date.now() - startTime;

    // For connectivity tests, any response (even 4xx) means the endpoint is reachable
    const isSuccess = isConnectivityTest
      ? (response.status < 500) // Endpoint is reachable if not a server error
      : (response.status >= 200 && response.status < 300);

    // Filter out large response data for cleaner reports
    const filteredData = filterResponseData(response.data);

    return {
      endpoint: name,
      method,
      success: isSuccess,
      statusCode: response.status,
      responseTime,
      responseData: filteredData,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    const responseTime = Date.now() - startTime;

    // For connectivity tests, if we got a response (even error), endpoint is reachable
    const isSuccess = isConnectivityTest && error.response?.status;

    // Filter out large response data for cleaner reports
    const filteredData = filterResponseData(error.response?.data);

    return {
      endpoint: name,
      method,
      success: isSuccess,
      statusCode: error.response?.status,
      responseTime,
      error: error.response?.data?.message || error.response?.data?.error || error.message,
      responseData: filteredData,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Filter out large/unnecessary data from responses to keep reports clean
 */
function filterResponseData(data: any): any {
  if (!data) return data;

  // If it's the T&C response, don't include the full message
  if (data.message && typeof data.message === 'string' && data.message.length > 200) {
    return {
      ...data,
      message: `[Message truncated - ${data.message.length} characters]`
    };
  }

  // If response has a very large nested object, summarize it
  if (typeof data === 'object') {
    const filtered: any = {};
    for (const key in data) {
      const value = data[key];
      if (typeof value === 'string' && value.length > 500) {
        filtered[key] = `[Truncated - ${value.length} characters]`;
      } else {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  return data;
}
