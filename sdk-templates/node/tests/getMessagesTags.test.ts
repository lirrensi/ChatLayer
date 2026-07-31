/**
 * Test suite for ChatLayer SDK getMessages query serialization.
 *
 * Verifies that `types` and `tags` params (array or single string) are
 * serialized as comma-joined query parameters, mirroring getRooms, and that
 * empty/whitespace-only values are omitted while roomId/limit/cursorId stay.
 */

import { ChatLayer } from '../chatLayerSDK';
import { createMockFetch, resetAllMocks } from './mocks/fetchMock';

const BASE_URL = 'https://api.test.com';

const createClient = (): ChatLayer => {
  return new ChatLayer({ apiKey: 'test-key', baseUrl: BASE_URL, botId: 'bot-1' });
};

const lastFetchUrl = (): string => {
  const calls = (global.fetch as jest.Mock).mock.calls;
  const lastCall = calls[calls.length - 1];
  if (!lastCall) throw new Error('fetch was not called');
  return String(lastCall[0]);
};

describe('ChatLayer.getMessages query serialization', () => {
  beforeEach(() => {
    resetAllMocks();
    global.fetch = createMockFetch({ json: { success: true, messages: [] } }) as any;
  });

  it('serializes tags as an array into a comma-joined tags param', async () => {
    const client = createClient();
    await client.getMessages({ roomId: 'room-1', tags: ['urgent', 'support'] });

    const url = lastFetchUrl();
    expect(url).toContain('/api/v1/getMessages?');
    expect(url).toContain('tags=urgent,support');
    expect(url).not.toContain('types=');
  });

  it('serializes tags as a single string into the tags param', async () => {
    const client = createClient();
    await client.getMessages({ roomId: 'room-1', tags: 'urgent' });

    const url = lastFetchUrl();
    expect(url).toContain('tags=urgent');
  });

  it('serializes types as an array into a comma-joined types param', async () => {
    const client = createClient();
    await client.getMessages({ roomId: 'room-1', types: ['user_message', 'error_message'] });

    const url = lastFetchUrl();
    expect(url).toContain('types=user_message,error_message');
    expect(url).not.toContain('tags=');
  });

  it('serializes types as a single string (legacy path unchanged)', async () => {
    const client = createClient();
    await client.getMessages({ roomId: 'room-1', types: 'user_message' });

    const url = lastFetchUrl();
    expect(url).toContain('types=user_message');
  });

  it('serializes both types and tags together', async () => {
    const client = createClient();
    await client.getMessages({
      roomId: 'room-1',
      types: ['user_message', 'manager_message'],
      tags: ['a', 'b'],
    });

    const url = lastFetchUrl();
    expect(url).toContain('types=user_message,manager_message');
    expect(url).toContain('tags=a,b');
  });

  it('omits tags/types params when the array is empty or whitespace-only', async () => {
    const client = createClient();
    await client.getMessages({ roomId: 'room-1', tags: ['', '  '], types: [] });

    const url = lastFetchUrl();
    expect(url).not.toContain('tags=');
    expect(url).not.toContain('types=');
  });

  it('still serializes roomId, limit and cursorId', async () => {
    const client = createClient();
    await client.getMessages({ roomId: 'room-1', limit: 25, cursorId: 42 });

    const url = lastFetchUrl();
    expect(url).toContain('roomId=room-1');
    expect(url).toContain('limit=25');
    expect(url).toContain('cursorId=42');
  });

  it('trims whitespace from serialized tag values', async () => {
    const client = createClient();
    await client.getMessages({ roomId: 'room-1', tags: ['  urgent ', 'support'] });

    const url = lastFetchUrl();
    expect(url).toContain('tags=urgent,support');
  });
});
