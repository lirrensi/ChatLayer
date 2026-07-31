/**
 * Fetch mocking utilities for testing ChatLayer SDK
 * Provides easy-to-use mock functions for different scenarios
 */

import { jest } from '@jest/globals';

/**
 * Type for a mocked fetch function
 */
export type FetchMock = jest.Mock<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>;

/**
 * Creates a mock Response object with the given body
 * @param body - The response body (can be string, object, or Error)
 * @param status - HTTP status code
 * @returns Mock Response object
 */
const createMockResponse = (
    body: unknown,
    status: number = 200
): Response => {
    const response = {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: new Headers(),
        redirected: false,
        type: 'basic' as const,
        url: '',
        body: null,
        bodyUsed: false,
        arrayBuffer: jest.fn<() => Promise<ArrayBuffer>>().mockResolvedValue(new ArrayBuffer(0)),
        blob: jest.fn<() => Promise<Blob>>().mockResolvedValue({} as Blob),
        formData: jest.fn<() => Promise<FormData>>().mockResolvedValue({} as FormData),
        bytes: jest.fn<() => Promise<Uint8Array>>().mockResolvedValue(new Uint8Array(0)),
        json: jest.fn<() => Promise<any>>().mockResolvedValue(body),
        text: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify(body)),
    } as any;

    response.clone = jest.fn<() => Response>().mockImplementation(() => response as Response);

    return response as Response;
};

/**
 * Creates a mock fetch function that can be used to mock HTTP requests
 * @param response - The response object to return (can include status, data, etc.)
 * @returns Mock fetch function
 */
export const createMockFetch = (
    response: {
        status?: number;
        ok?: boolean;
        data?: any;
        error?: string;
        json?: any;
    } = {}
): FetchMock => {
    return jest.fn<any>().mockResolvedValue(
        createMockResponse(response.json ?? response.data ?? {}, response.status ?? 200)
    ) as FetchMock;
};

/**
 * Creates a mock fetch that returns an error response
 * @param statusCode - HTTP status code
 * @param message - Error message in response body
 * @returns Mock fetch function
 */
export const createErrorMockFetch = (
    statusCode: number = 500,
    message: string = 'Internal Server Error'
): FetchMock => {
    return createMockFetch({
        ok: false,
        status: statusCode,
        error: message,
        json: {
            success: false,
            errorMessage: message,
        },
    });
};

/**
 * Creates a mock fetch that simulates network failure
 * @returns Mock fetch function that throws an error
 */
export const createNetworkErrorMockFetch = (): FetchMock => {
    return jest.fn<any>().mockRejectedValue(new Error('Network request failed')) as FetchMock;
};

/**
 * Creates a mock fetch that simulates a timeout
 * @returns Mock fetch function that throws a timeout error
 */
export const createTimeoutMockFetch = (): FetchMock => {
    return jest.fn<any>().mockRejectedValue(new Error('Request timeout')) as FetchMock;
};

/**
 * Creates a mock fetch with multiple responses for different URLs
 * @param responses - Object mapping URL patterns to responses
 * @returns Mock fetch function
 */
export const createMultiResponseMockFetch = (
    responses: Record<string, any>
): FetchMock => {
    return jest.fn<any>().mockImplementation(async (url: string | URL) => {
        const urlString = typeof url === 'string' ? url : url.toString();
        const matchedResponse = Object.entries(responses).find(([pattern]) => {
            // Simple pattern matching - could be enhanced with regex
            return urlString.includes(pattern.replace(/\*/g, ''));
        })?.[1];

        if (matchedResponse) {
            return createMockResponse(
                matchedResponse.json ?? matchedResponse.data ?? {},
                matchedResponse.status ?? 200
            );
        }

        // Default 404 response
        return createMockResponse(
            { error: 'Not Found' },
            404
        );
    }) as FetchMock;
};

/**
 * Resets all mock fetch instances (use in afterEach)
 */
export const resetAllMocks = (): void => {
    jest.clearAllMocks();
};

/**
 * Verifies that fetch was called with expected parameters
 * @param expectedUrl - Expected URL pattern (can include wildcards)
 * @param expectedMethod - Expected HTTP method (default: 'GET' or 'POST')
 * @param expectedBody - Expected request body (for POST requests)
 */
export const verifyFetchCall = (
    expectedUrl: string,
    expectedMethod?: string,
    expectedBody?: any
): void => {
    const fetchMock = global.fetch as unknown as FetchMock;
    const calls = fetchMock.mock.calls;
    const lastCall = calls[calls.length - 1];

    if (!lastCall) {
        throw new Error('fetch was not called');
    }

    const [url, options = {}] = lastCall;
    const urlString = typeof url === 'string' ? url : url.toString();

    if (!urlString.includes(expectedUrl.replace(/\*/g, ''))) {
        throw new Error(
            `Expected fetch to be called with URL containing "${expectedUrl}", but got "${urlString}"`
        );
    }

    if (expectedMethod && options.method !== expectedMethod) {
        throw new Error(
            `Expected fetch to be called with method "${expectedMethod}", but got "${options.method}"`
        );
    }

    if (expectedBody && options.body) {
        const body = JSON.parse(options.body as string);
        if (JSON.stringify(body) !== JSON.stringify(expectedBody)) {
            throw new Error(
                `Expected fetch to be called with body "${JSON.stringify(expectedBody)}", but got "${JSON.stringify(body)}"`
            );
        }
    }
};
