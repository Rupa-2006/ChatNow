import type { ApiSuccess, AuthResponseData, Me, SessionInfo } from '@/types/api';
import { http } from './http';

export type RegisterPayload = {
  email: string;
  username: string;
  displayName: string;
  password: string;
};

export type LoginPayload = {
  identifier: string;
  password: string;
};

export type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
};

export async function registerUser(payload: RegisterPayload): Promise<AuthResponseData> {
  const res = await http.post<ApiSuccess<AuthResponseData>>('/auth/register', payload);
  return res.data.data;
}

export async function loginUser(payload: LoginPayload): Promise<AuthResponseData> {
  const res = await http.post<ApiSuccess<AuthResponseData>>('/auth/login', payload);
  return res.data.data;
}

export async function logoutUser(): Promise<void> {
  await http.post('/auth/logout');
}

export async function logoutAllDevices(): Promise<void> {
  await http.post('/auth/logout-all');
}

export async function fetchMe(): Promise<Me> {
  const res = await http.get<ApiSuccess<Me>>('/auth/me');
  return res.data.data;
}

export async function fetchSessions(): Promise<SessionInfo[]> {
  const res = await http.get<ApiSuccess<SessionInfo[]>>('/auth/sessions');
  return res.data.data;
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  await http.delete(`/auth/sessions/${encodeURIComponent(sessionId)}`);
}

export async function changePassword(payload: ChangePasswordPayload): Promise<void> {
  await http.post('/auth/change-password', payload);
}
