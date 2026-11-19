import { Router } from 'express';
import * as attachmentController from '../controllers/attachment.controller.js';
import * as authController from '../controllers/auth.controller.js';
import * as conversationController from '../controllers/conversation.controller.js';
import { health } from '../controllers/health.controller.js';
import * as messageController from '../controllers/message.controller.js';
import * as notificationController from '../controllers/notification.controller.js';
import * as userController from '../controllers/user.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import type { Limiters } from '../middleware/rateLimit.js';
import { uploadAttachmentMiddleware, uploadAvatarMiddleware } from '../middleware/upload.js';

/**
 * URL → handler wiring only. Express 5 forwards a rejected promise from an async
 * handler to the error middleware, so handlers need no try/catch wrappers.
 */
export function buildApiRouter(limiters: Limiters): Router {
  const api = Router();

  api.get('/health', health);
  // Avatar images (magic-byte validated JPEG/PNG/WebP with random UUID filenames)
  api.get('/avatars/:filename', attachmentController.serveAvatar);

  // --- Authentication ------------------------------------------------------
  const auth = Router();
  auth.post('/register', limiters.authStrict, authController.register);
  auth.post('/login', limiters.authStrict, authController.login);
  auth.post('/refresh', limiters.authRefresh, authController.refresh);
  auth.post('/logout', limiters.authRefresh, authController.logout);

  auth.use(authenticate, limiters.api);
  auth.post('/logout-all', authController.logoutAll);
  auth.get('/me', authController.me);
  auth.get('/sessions', authController.listSessions);
  auth.delete('/sessions/:id', authController.revokeSession);
  auth.post('/change-password', limiters.authStrict, authController.changePassword);
  api.use('/auth', auth);

  // --- Users ---------------------------------------------------------------
  const users = Router();
  users.use(authenticate, limiters.api);
  users.get('/', userController.list);
  // Fixed paths are registered before '/:id' so they are not captured as an id.
  users.get('/search', limiters.search, userController.search);
  users.get('/blocks', userController.listBlocks);
  users.patch('/profile', userController.updateProfile);
  users.post('/avatar', limiters.uploads, uploadAvatarMiddleware, userController.uploadAvatar);
  users.get('/:id', userController.getById);
  users.post('/:id/block', userController.block);
  users.delete('/:id/block', userController.unblock);
  api.use('/users', users);

  // --- Conversations -------------------------------------------------------
  const conversations = Router();
  conversations.use(authenticate, limiters.api);
  conversations.get('/', conversationController.list);
  conversations.post('/', conversationController.create);
  conversations.get('/:id', conversationController.getById);
  conversations.patch('/:id', conversationController.update);
  conversations.post('/:id/avatar', limiters.uploads, uploadAvatarMiddleware, conversationController.uploadAvatar);
  conversations.post('/:id/members', conversationController.addMembers);
  conversations.delete('/:id/members/:userId', conversationController.removeMember);
  conversations.patch('/:id/members/:userId', conversationController.updateMemberRole);
  conversations.post('/:id/leave', conversationController.leave);
  conversations.post('/:id/read', conversationController.markRead);
  conversations.get('/:id/attachments', conversationController.listAttachments);
  conversations.get('/:id/messages', messageController.list);
  conversations.post('/:id/messages', messageController.send);
  conversations.get('/:id/messages/search', limiters.search, messageController.searchInConversation);
  api.use('/conversations', conversations);

  // --- Messages ------------------------------------------------------------
  const messages = Router();
  messages.use(authenticate, limiters.api);
  messages.get('/search', limiters.search, messageController.searchAll);
  messages.patch('/:id', messageController.edit);
  messages.delete('/:id', messageController.remove);
  messages.put('/:id/reactions', messageController.addReaction);
  messages.delete('/:id/reactions/:emoji', messageController.removeReaction);
  api.use('/messages', messages);

  // --- Attachments ---------------------------------------------------------
  const attachments = Router();
  attachments.use(authenticate, limiters.api);
  attachments.post('/', limiters.uploads, uploadAttachmentMiddleware, attachmentController.upload);
  attachments.get('/:id/download', attachmentController.download);
  api.use('/attachments', attachments);

  // --- Notifications -------------------------------------------------------
  const notifications = Router();
  notifications.use(authenticate, limiters.api);
  notifications.get('/', notificationController.list);
  notifications.post('/read-all', notificationController.markAllRead);
  notifications.patch('/:id/read', notificationController.markRead);
  api.use('/notifications', notifications);

  return api;
}
