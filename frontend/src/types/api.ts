/**
 * Shared API DTOs matching docs/03-rest-api.md and backend services.
 */

export type NotificationPrefs = {
  browser: boolean;
  sound: boolean;
  messagePreview: boolean;
};

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
};

export type Me = PublicUser & {
  email: string;
  createdAt: string;
  notificationPrefs: NotificationPrefs;
};

export type AuthResponseData = {
  user: Me;
  accessToken: string;
};

export type RefreshResponseData = {
  accessToken: string;
};

export type SessionInfo = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
};

export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export type Member = {
  user: PublicUser;
  role: MemberRole;
  joinedAt: string;
};

export type Attachment = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  url: string;
};

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'TEXT' | 'FILE' | 'SYSTEM';
  content: string;
  clientId: string;
  replyTo: {
    id: string;
    senderId: string;
    content: string;
    deleted: boolean;
  } | null;
  attachments: Attachment[];
  reactions: { emoji: string; userIds: string[] }[];
  status: MessageStatus;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

export type Conversation = {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string | null;
  avatarUrl: string | null;
  members: Member[];
  lastMessage: Message | null;
  unreadCount: number;
  mutedUntil: string | null;
  myRole: MemberRole;
  createdAt: string;
  lastMessageAt: string | null;
};

export type NotificationType =
  | 'NEW_MESSAGE'
  | 'ADDED_TO_GROUP'
  | 'REMOVED_FROM_GROUP'
  | 'ROLE_CHANGED'
  | 'MENTION';

export type NotificationItem = {
  id: string;
  type: NotificationType;
  conversationId: string | null;
  messageId: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type GlobalMessageHit = Message & {
  conversation: { id: string; name: string | null; type: 'DIRECT' | 'GROUP' };
};

export type ApiSuccess<T, M = undefined> = M extends undefined
  ? { data: T }
  : { data: T; meta: M };

export type PaginationMeta = {
  nextCursor: string | null;
};

export type ApiErrorDetail = {
  path?: string;
  message: string;
};

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
  };
};
