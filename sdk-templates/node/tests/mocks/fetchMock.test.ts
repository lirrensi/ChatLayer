/**
 * Test suite for fetch mocking utilities
 */

import {
  createMockFetch,
  createErrorMockFetch,
  createNetworkErrorMockFetch,
  createTimeoutMockFetch,
  createMultiResponseMockFetch,
  resetAllMocks,
  verifyFetchCall,
} from '../mocks/fetchMock';

describe('fetchMock utilities', () => {
  beforeEach(() => {
    resetAllMocks();
    global.fetch = jest.fn();
  });

  describe('createMockFetch', () => {
    it('should create a mock fetch with default success response', async () => {
      const mockFetch = createMockFetch();

      const result: any = await mockFetch('https://api.test.com/api/v1/addMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ botId: 'bot-1', text: 'Hello' }),
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({});
    });

    it('should create a mock fetch with custom data', async () => {
      const mockFetch = createMockFetch({
        status: 201,
        data: { success: true, message: { id: '123', text: 'Created' } },
      });

      const result: any = await mockFetch('https://api.test.com/api/v1/addMessage');

      expect(result.status).toBe(201);
      expect(result.ok).toBe(true);
      expect(await result.json()).toEqual({ success: true, message: { id: '123', text: 'Created' } });
    });

    it('should create a mock fetch with custom JSON response', async () => {
      const mockFetch = createMockFetch({
        json: { user: { id: 1, name: 'Test User' } },
      });

      const result: any = await mockFetch('https://api.test.com/api/v1/addUser');

      expect(await result.json()).toEqual({ user: { id: 1, name: 'Test User' } });
    });

    it('should create a mock fetch with custom status code', async () => {
      const mockFetch = createMockFetch({ status: 404 });

      const result: any = await mockFetch('https://api.test.com/api/v1/addMessage');

      expect(result.status).toBe(404);
      expect(result.ok).toBe(false);
    });
  });

  describe('createErrorMockFetch', () => {
    it('should create a mock fetch with error response', async () => {
      const mockFetch = createErrorMockFetch(400, 'Bad Request');

      const result: any = await mockFetch('https://api.test.com/api/v1/addMessage');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(await result.json()).toEqual({
        success: false,
        errorMessage: 'Bad Request',
      });
    });

    it('should create a mock fetch with default 500 error', async () => {
      const mockFetch = createErrorMockFetch();

      const result: any = await mockFetch('https://api.test.com/api/v1/addMessage');

      expect(result.status).toBe(500);
      expect(result.ok).toBe(false);
    });

    it('should create a mock fetch with custom error message', async () => {
      const mockFetch = createErrorMockFetch(401, 'Unauthorized');

      const result: any = await mockFetch('https://api.test.com/api/v1/addMessage');

      expect(await result.json()).toEqual({
        success: false,
        errorMessage: 'Unauthorized',
      });
    });
  });

  describe('createNetworkErrorMockFetch', () => {
    it('should create a mock fetch that throws a network error', async () => {
      const mockFetch = createNetworkErrorMockFetch();

      await expect(mockFetch('https://api.test.com/api/v1/addMessage')).rejects.toThrow(
        'Network request failed'
      );
    });

    it('should throw an error when called', () => {
      const mockFetch = createNetworkErrorMockFetch();

      expect(mockFetch).toBeDefined();
      expect(typeof mockFetch).toBe('function');
    });
  });

  describe('createTimeoutMockFetch', () => {
    it('should create a mock fetch that throws a timeout error', async () => {
      const mockFetch = createTimeoutMockFetch();

      await expect(mockFetch('https://api.test.com/api/v1/addMessage')).rejects.toThrow(
        'Request timeout'
      );
    });
  });

  describe('createMultiResponseMockFetch', () => {
    it('should return different responses based on URL pattern', async () => {
      const mockFetch = createMultiResponseMockFetch({
        '/api/v1/addMessage': { data: { id: '1', text: 'Hello' } },
        '/api/v1/addUser': { data: { id: 2, name: 'User' } },
      });

      const addMessageResponse: any = await mockFetch('https://api.test.com/api/v1/addMessage');
      const addUserResponse: any = await mockFetch('https://api.test.com/api/v1/addUser');

      expect(await addMessageResponse.json()).toEqual({ id: '1', text: 'Hello' });
      expect(await addUserResponse.json()).toEqual({ id: 2, name: 'User' });
    });

    it('should return 404 for unmatched URL', async () => {
      const mockFetch = createMultiResponseMockFetch({
        '/api/v1/addMessage': { data: { id: '1' } },
      });

      const response: any = await mockFetch('https://api.test.com/api/v1/unknown');

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });

    it('should support wildcard patterns', async () => {
      const mockFetch = createMultiResponseMockFetch({
        '/api/v1/*': { data: { id: 'wildcard' } },
      });

      const response: any = await mockFetch('https://api.test.com/api/v1/addMessage');

      expect(response.ok).toBe(true);
      expect(await response.json()).toEqual({ id: 'wildcard' });
    });
  });

  describe('resetAllMocks', () => {
    it('should reset all mock calls', async () => {
      const mockFetch = createMockFetch({
        status: 200,
        data: { id: '1' },
      });

      // First call
      await mockFetch('https://api.test.com/api/v1/addMessage');

      expect(global.fetch).toHaveBeenCalledTimes(1);

      resetAllMocks();

      expect(global.fetch).toHaveBeenCalledTimes(0);
    });

    it('should clear mock implementations', () => {
      const mockFetch = createMockFetch();

      expect(global.fetch).toBeDefined();
      resetAllMocks();
      expect(global.fetch).toBeDefined();
    });
  });

  describe('verifyFetchCall', () => {
    it('should verify fetch was called with correct URL', () => {
      const mockFetch = createMockFetch();
      global.fetch = mockFetch as any;

      (mockFetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(''),
        json: jest.fn().mockResolvedValue({ success: true }),
        headers: new Headers(),
      });

      mockFetch('https://api.test.com/api/v1/addMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ botId: 'bot-1', text: 'Hello' }),
      });

      expect(() => verifyFetchCall('/api/v1/addMessage')).not.toThrow();
    });

    it('should verify fetch was called with correct method', () => {
      const mockFetch = createMockFetch();
      global.fetch = mockFetch as any;

      (mockFetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(''),
        json: jest.fn().mockResolvedValue({ success: true }),
        headers: new Headers(),
      });

      mockFetch('https://api.test.com/api/v1/addMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
      });

      expect(() => verifyFetchCall('/api/v1/addMessage', 'POST')).not.toThrow();
    });

    it('should verify fetch was called with correct body', () => {
      const mockFetch = createMockFetch();
      global.fetch = mockFetch as any;

      (mockFetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(''),
        json: jest.fn().mockResolvedValue({ success: true }),
        headers: new Headers(),
      });

      mockFetch('https://api.test.com/api/v1/addMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ botId: 'bot-1', text: 'Hello' }),
      });

      expect(() =>
        verifyFetchCall('/api/v1/addMessage', 'POST', { botId: 'bot-1', text: 'Hello' })
      ).not.toThrow();
    });

    it('should throw error if fetch was not called', () => {
      expect(() => verifyFetchCall('/api/v1/addMessage')).toThrow('fetch was not called');
    });

    it('should throw error if URL does not match', () => {
      const mockFetch = createMockFetch();
      global.fetch = mockFetch as any;

      (mockFetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(''),
        json: jest.fn().mockResolvedValue({ success: true }),
        headers: new Headers(),
      });

      mockFetch('https://api.test.com/api/v1/addMessage');

      expect(() => verifyFetchCall('/api/v1/unknown')).toThrow(
        'Expected fetch to be called with URL containing "/api/v1/unknown"'
      );
    });

    it('should throw error if method does not match', () => {
      const mockFetch = createMockFetch();
      global.fetch = mockFetch as any;

      (mockFetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(''),
        json: jest.fn().mockResolvedValue({ success: true }),
        headers: new Headers(),
      });

      mockFetch('https://api.test.com/api/v1/addMessage', {
        method: 'POST',
      });

      expect(() => verifyFetchCall('/api/v1/addMessage', 'GET')).toThrow(
        'Expected fetch to be called with method "GET", but got "POST"'
      );
    });

    it('should throw error if body does not match', () => {
      const mockFetch = createMockFetch();
      global.fetch = mockFetch as any;

      (mockFetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(''),
        json: jest.fn().mockResolvedValue({ success: true }),
        headers: new Headers(),
      });

      mockFetch('https://api.test.com/api/v1/addMessage', {
        method: 'POST',
        body: JSON.stringify({ botId: 'bot-1', text: 'Hello' }),
      });

      expect(() =>
        verifyFetchCall('/api/v1/addMessage', 'POST', { botId: 'bot-2', text: 'Hello' })
      ).toThrow('Expected fetch to be called with body');
    });
  });
});
