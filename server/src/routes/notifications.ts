import { Router, Response } from 'express';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/notificationService';

export const notificationsRouter = Router();
notificationsRouter.use(piAuthMiddleware);

/** GET /api/notifications — the signed-in user's notifications (newest first). */
notificationsRouter.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const notifications = await listNotifications(req.user!.id);
  res.json({ notifications });
});

/** POST /api/notifications/read-all — mark all of the user's unread as read. */
notificationsRouter.post(
  '/read-all',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const updated = await markAllNotificationsRead(req.user!.id);
    res.json({ updated });
  },
);

/** POST /api/notifications/:id/read — mark one notification read. */
notificationsRouter.post(
  '/:id/read',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const ok = await markNotificationRead(req.user!.id, String(req.params.id));
    if (!ok) {
      res.status(404).json({ error: 'Notification not found or already read' });
      return;
    }
    res.json({ ok: true });
  },
);
