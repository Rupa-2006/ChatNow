import type { ApiSuccess, NotificationItem } from '@/types/api';
import { http } from './http';

export async function listNotifications(params?: {
  unreadOnly?: boolean;
  limit?: number;
  cursor?: string;
}): Promise<{ notifications: NotificationItem[]; nextCursor: string | null; unreadCount: number }> {
  const res = await http.get<
    ApiSuccess<NotificationItem[], { nextCursor: string | null; unreadCount: number }>
  >('/notifications', { params });
  return {
    notifications: res.data.data,
    nextCursor: res.data.meta.nextCursor,
    unreadCount: res.data.meta.unreadCount,
  };
}

export async function markNotificationRead(id: string): Promise<NotificationItem> {
  const res = await http.patch<ApiSuccess<NotificationItem>>(
    `/notifications/${encodeURIComponent(id)}/read`,
  );
  return res.data.data;
}

export async function markAllNotificationsRead(): Promise<void> {
  await http.post('/notifications/read-all');
}
