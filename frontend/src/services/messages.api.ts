import type { ApiSuccess, GlobalMessageHit, Message, PaginationMeta } from '@/types/api';
import { http } from './http';

export async function listMessages(
  conversationId: string,
  params?: { limit?: number; cursor?: string; around?: string },
): Promise<{ messages: Message[]; nextCursor: string | null }> {
  const res = await http.get<ApiSuccess<Message[], PaginationMeta>>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { params },
  );
  return { messages: res.data.data, nextCursor: res.data.meta.nextCursor };
}

export async function sendMessageRest(
  conversationId: string,
  payload: { content: string; clientId: string; replyToId?: string | null; attachmentIds?: string[] },
): Promise<Message> {
  const res = await http.post<ApiSuccess<Message>>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    payload,
  );
  return res.data.data;
}

export async function searchConversationMessages(
  conversationId: string,
  q: string,
  params?: { limit?: number; cursor?: string },
): Promise<{ messages: Message[]; nextCursor: string | null }> {
  const res = await http.get<ApiSuccess<Message[], PaginationMeta>>(
    `/conversations/${encodeURIComponent(conversationId)}/messages/search`,
    { params: { q, ...params } },
  );
  return { messages: res.data.data, nextCursor: res.data.meta.nextCursor };
}

export async function searchAllMessages(
  q: string,
  params?: { limit?: number; cursor?: string },
): Promise<{ messages: GlobalMessageHit[]; nextCursor: string | null }> {
  const res = await http.get<ApiSuccess<GlobalMessageHit[], PaginationMeta>>('/messages/search', {
    params: { q, ...params },
  });
  return { messages: res.data.data, nextCursor: res.data.meta.nextCursor };
}

export async function editMessageRest(messageId: string, content: string): Promise<Message> {
  const res = await http.patch<ApiSuccess<Message>>(
    `/messages/${encodeURIComponent(messageId)}`,
    { content },
  );
  return res.data.data;
}

export async function deleteMessageRest(messageId: string): Promise<void> {
  await http.delete(`/messages/${encodeURIComponent(messageId)}`);
}

export async function addReactionRest(messageId: string, emoji: string): Promise<Message> {
  const res = await http.put<ApiSuccess<Message>>(
    `/messages/${encodeURIComponent(messageId)}/reactions`,
    { emoji },
  );
  return res.data.data;
}

export async function removeReactionRest(messageId: string, emoji: string): Promise<Message> {
  const res = await http.delete<ApiSuccess<Message>>(
    `/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
  );
  return res.data.data;
}
