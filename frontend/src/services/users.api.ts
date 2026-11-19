import type { ApiSuccess, Me, NotificationPrefs, PaginationMeta, PublicUser } from '@/types/api';
import { http } from './http';

export type UpdateProfilePayload = {
  displayName?: string;
  username?: string;
  bio?: string | null;
  notificationPrefs?: Partial<NotificationPrefs>;
};

export async function listUsers(params?: {
  limit?: number;
  cursor?: string;
}): Promise<{ users: PublicUser[]; nextCursor: string | null }> {
  const res = await http.get<ApiSuccess<PublicUser[], PaginationMeta>>('/users', { params });
  return { users: res.data.data, nextCursor: res.data.meta.nextCursor };
}

export async function searchUsers(q: string, limit = 20): Promise<PublicUser[]> {
  const res = await http.get<ApiSuccess<PublicUser[]>>('/users/search', {
    params: { q, limit },
  });
  return res.data.data;
}

export async function getUserById(id: string): Promise<PublicUser> {
  const res = await http.get<ApiSuccess<PublicUser>>(`/users/${encodeURIComponent(id)}`);
  return res.data.data;
}

export async function updateMyProfile(payload: UpdateProfilePayload): Promise<Me> {
  const res = await http.patch<ApiSuccess<Me>>('/users/profile', payload);
  return res.data.data;
}

export async function fetchBlockedUsers(): Promise<PublicUser[]> {
  const res = await http.get<ApiSuccess<PublicUser[]>>('/users/blocks');
  return res.data.data;
}

export async function blockUserById(userId: string): Promise<void> {
  await http.post(`/users/${encodeURIComponent(userId)}/block`);
}

export async function unblockUserById(userId: string): Promise<void> {
  await http.delete(`/users/${encodeURIComponent(userId)}/block`);
}
