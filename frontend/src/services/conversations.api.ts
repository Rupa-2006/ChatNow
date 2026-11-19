import type { ApiSuccess, Attachment, Conversation, Member, PaginationMeta } from '@/types/api';
import { http } from './http';

export async function listConversations(q?: string): Promise<Conversation[]> {
  const res = await http.get<ApiSuccess<Conversation[]>>('/conversations', {
    params: q ? { q } : undefined,
  });
  return res.data.data;
}

export async function getConversation(id: string): Promise<Conversation> {
  const res = await http.get<ApiSuccess<Conversation>>(`/conversations/${encodeURIComponent(id)}`);
  return res.data.data;
}

export async function createDirectConversation(userId: string): Promise<Conversation> {
  const res = await http.post<ApiSuccess<Conversation>>('/conversations', {
    type: 'DIRECT',
    userId,
  });
  return res.data.data;
}

export async function createGroupConversation(name: string, memberIds: string[]): Promise<Conversation> {
  const res = await http.post<ApiSuccess<Conversation>>('/conversations', {
    type: 'GROUP',
    name,
    memberIds,
  });
  return res.data.data;
}

export async function updateConversation(
  id: string,
  payload: { name?: string; mutedUntil?: string | null },
): Promise<Conversation> {
  const res = await http.patch<ApiSuccess<Conversation>>(
    `/conversations/${encodeURIComponent(id)}`,
    payload,
  );
  return res.data.data;
}

export async function uploadConversationAvatar(id: string, file: File): Promise<Conversation> {
  const form = new FormData();
  form.append('file', file);
  const res = await http.post<ApiSuccess<Conversation>>(
    `/conversations/${encodeURIComponent(id)}/avatar`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return res.data.data;
}

export async function addConversationMembers(id: string, userIds: string[]): Promise<Conversation> {
  const res = await http.post<ApiSuccess<Conversation>>(
    `/conversations/${encodeURIComponent(id)}/members`,
    { userIds },
  );
  return res.data.data;
}

export async function removeConversationMember(id: string, userId: string): Promise<void> {
  await http.delete(`/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`);
}

export async function updateConversationMemberRole(
  id: string,
  userId: string,
  role: 'ADMIN' | 'MEMBER',
): Promise<Member> {
  const res = await http.patch<ApiSuccess<Member>>(
    `/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    { role },
  );
  return res.data.data;
}

export async function leaveConversation(id: string): Promise<void> {
  await http.post(`/conversations/${encodeURIComponent(id)}/leave`);
}

export async function markConversationRead(id: string, messageId: string): Promise<void> {
  await http.post(`/conversations/${encodeURIComponent(id)}/read`, { messageId });
}

export async function listConversationAttachments(
  id: string,
  params?: { limit?: number; cursor?: string },
): Promise<{ attachments: Attachment[]; nextCursor: string | null }> {
  const res = await http.get<ApiSuccess<Attachment[], PaginationMeta>>(
    `/conversations/${encodeURIComponent(id)}/attachments`,
    { params },
  );
  return { attachments: res.data.data, nextCursor: res.data.meta.nextCursor };
}
