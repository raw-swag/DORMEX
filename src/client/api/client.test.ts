import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJson, ApiError, AuthApiClient, InventoryApiClient, NotificationsApiClient } from './client.js';

describe('DORMEX Frontend API Client Infrastructure Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('unwraps JSON payloads and injects Accept/Content-Type headers', async () => {
    const mockData = { status: 'OK', count: 42 };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
    });

    const result = await requestJson('/api/test-path', {
      method: 'POST',
      body: JSON.stringify({ key: 'val' }),
    });

    expect(result).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const callArgs = (global.fetch as any).mock.calls[0];
    expect(callArgs[0]).toBe('/api/test-path');
    const headers = callArgs[1].headers;
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('handles 204 No Content gracefully without failing JSON parsing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => { throw new Error('Unexpected JSON token'); },
    });

    const result = await requestJson('/api/no-content');
    expect(result).toEqual({});
  });

  it('throws structured ApiError with HTTP status and parsed server error body', async () => {
    const errorPayload = { error: 'UNAUTHORIZED: Session expired', code: 'AUTH_EXPIRED' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => errorPayload,
    });

    await expect(requestJson('/api/protected')).rejects.toThrow(ApiError);
    try {
      await requestJson('/api/protected');
    } catch (err: any) {
      expect(err.name).toBe('ApiError');
      expect(err.status).toBe(401);
      expect(err.message).toBe('UNAUTHORIZED: Session expired');
      expect(err.details).toEqual(errorPayload);
    }
  });

  it('domain clients call expected API routes with correct methods', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await AuthApiClient.getMe();
    expect(global.fetch).toHaveBeenLastCalledWith('/api/auth/me', expect.any(Object));

    await InventoryApiClient.getBuildings();
    expect(global.fetch).toHaveBeenLastCalledWith('/api/buildings', expect.any(Object));

    await NotificationsApiClient.markAsRead(['notif_1', 'notif_2']);
    expect(global.fetch).toHaveBeenLastCalledWith('/api/notifications/mark-read', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ notificationIds: ['notif_1', 'notif_2'] }),
    }));
  });
});
