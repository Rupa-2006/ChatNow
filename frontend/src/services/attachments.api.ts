import type { ApiSuccess, Attachment, Me } from '@/types/api';
import { http } from './http';

export async function uploadAttachment(file: File): Promise<Attachment> {
  const form = new FormData();
  form.append('file', file);
  const res = await http.post<ApiSuccess<Attachment>>('/attachments', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

export async function uploadMyAvatar(file: File): Promise<Me> {
  const form = new FormData();
  form.append('file', file);
  const res = await http.post<ApiSuccess<Me>>('/users/avatar', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

/**
 * Fetches an authorized attachment as a Blob (sending the in-memory Bearer token)
 * so private conversation images & downloads never expose credentials in URLs.
 */
export async function fetchAttachmentBlob(attachmentId: string): Promise<Blob> {
  const res = await http.get<Blob>(`/attachments/${encodeURIComponent(attachmentId)}/download`, {
    responseType: 'blob',
  });
  return res.data;
}
