/**
 * DORMEX Frontend API Client Infrastructure
 * 
 * Centralized, typed HTTP client eliminating scattered raw fetch/apiFetch calls,
 * providing uniform response error unwrapping, CSRF/credential handling,
 * and request cancellation capabilities.
 */

import { apiFetch, UserSession } from '../context/AuthContext.js';

export interface ApiResponse<T = any> {
  data: T;
  status: number;
}

export class ApiError extends Error {
  public status: number;
  public details?: any;

  constructor(message: string, status: number, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Standard typed JSON wrapper around the authenticated session fetch.
 */
export async function requestJson<T = any>(
  path: string,
  options: RequestInit = {},
  session?: UserSession | null
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await apiFetch(path, { ...options, headers }, session);

  if (!res.ok) {
    let errBody: any;
    try {
      errBody = await res.json();
    } catch {
      errBody = { error: res.statusText || 'Request failed' };
    }
    const message = errBody.error || errBody.message || `HTTP ${res.status}: ${res.statusText}`;
    throw new ApiError(message, res.status, errBody);
  }

  // Handle empty responses (204 No Content)
  if (res.status === 204) {
    return {} as T;
  }

  return (await res.json()) as T;
}

/**
 * Modular Domain API Clients
 */

export const AuthApiClient = {
  getMe: (session?: UserSession | null) => 
    requestJson('/api/auth/me', { method: 'GET' }, session),
  
  logout: (session?: UserSession | null) => 
    requestJson('/api/auth/logout', { method: 'POST' }, session),

  forgotPassword: (emailOrCollegeId: string) => 
    requestJson('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ emailOrCollegeId }),
    }),

  resetPassword: (payload: { token: string; newPassword: string }) => 
    requestJson('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

export const InventoryApiClient = {
  getBuildings: (session?: UserSession | null) => 
    requestJson('/api/buildings', { method: 'GET' }, session),

  getBuildingFloors: (buildingId: string, session?: UserSession | null) => 
    requestJson(`/api/buildings/${encodeURIComponent(buildingId)}/floors`, { method: 'GET' }, session),

  getFloorRooms: (floorId: string, session?: UserSession | null) => 
    requestJson(`/api/floors/${encodeURIComponent(floorId)}/rooms`, { method: 'GET' }, session),

  getFloorMap: (floorId: string, session?: UserSession | null) => 
    requestJson(`/api/floors/${encodeURIComponent(floorId)}/map`, { method: 'GET' }, session),

  getFloorState: (floorId: string, session?: UserSession | null) => 
    requestJson(`/api/floors/${encodeURIComponent(floorId)}/state`, { method: 'GET' }, session),

  saveFloorDraft: (floorId: string, payload: any, session?: UserSession | null) => 
    requestJson(`/api/floors/${encodeURIComponent(floorId)}/draft`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, session),

  publishFloorMap: (floorId: string, payload: any, session?: UserSession | null) => 
    requestJson(`/api/floors/${encodeURIComponent(floorId)}/publish`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, session),
};

export const GovernanceApiClient = {
  getActions: (session?: UserSession | null) => 
    requestJson('/api/governance/actions', { method: 'GET' }, session),

  submitAction: (payload: any, session?: UserSession | null) => 
    requestJson('/api/governance/actions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, session),

  reviewAction: (actionId: string, payload: { decision: 'APPROVED' | 'REJECTED'; comments: string }, session?: UserSession | null) => 
    requestJson(`/api/governance/actions/${encodeURIComponent(actionId)}/review`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, session),

  appointWarden: (payload: { userId: string; buildingId: string; reason: string }, session?: UserSession | null) => 
    requestJson('/api/governance/wardens', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, session),

  appointDeputy: (payload: { userId: string; buildingId: string; supervisorWardenApptId: string; reason: string }, session?: UserSession | null) => 
    requestJson('/api/governance/deputies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, session),

  revokeWarden: (appointmentId: string, payload: { reason: string }, session?: UserSession | null) => 
    requestJson(`/api/governance/wardens/${encodeURIComponent(appointmentId)}/revoke`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, session),

  revokeDeputy: (appointmentId: string, payload: { reason: string }, session?: UserSession | null) => 
    requestJson(`/api/governance/deputies/${encodeURIComponent(appointmentId)}/revoke`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, session),
};

export const NotificationsApiClient = {
  getNotifications: (session?: UserSession | null) => 
    requestJson('/api/notifications', { method: 'GET' }, session),

  markAsRead: (notificationIds?: string[], session?: UserSession | null) => 
    requestJson('/api/notifications/mark-read', {
      method: 'POST',
      body: JSON.stringify({ notificationIds }),
    }, session),

  broadcastNotice: (payload: { title: string; message: string; scopeType: string; scopeId?: string; priority?: string }, session?: UserSession | null) => 
    requestJson('/api/admin/notices', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, session),
};

export const MessMenuApiClient = {
  getActiveMenu: (session?: UserSession | null) => 
    requestJson('/api/mess/menu/active', { method: 'GET' }, session),

  getMenus: (params?: { scopeType?: string; scopeId?: string }, session?: UserSession | null) => {
    const q = new URLSearchParams();
    if (params?.scopeType) q.set('scopeType', params.scopeType);
    if (params?.scopeId) q.set('scopeId', params.scopeId);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return requestJson(`/api/mess/menus${qs}`, { method: 'GET' }, session);
  },

  createMenu: (payload: any, session?: UserSession | null) => 
    requestJson('/api/mess/menus', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, session),

  updateMenuStatus: (menuId: string, status: string, session?: UserSession | null) => 
    requestJson(`/api/mess/menus/${encodeURIComponent(menuId)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }, session),
};
