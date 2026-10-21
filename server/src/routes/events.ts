import { Router } from 'express';
import { recordClientEvents, eventBatchSchema } from '../analytics/events';
import { eventLimiter } from '../auth/rateLimit';
import { asyncHandler } from '../http/errors';
import { parseBody } from '../http/validate';

export const eventsRouter = Router();

eventsRouter.post(
  '/',
  eventLimiter,
  asyncHandler(async (req, res) => {
    const payload = parseBody(eventBatchSchema, req.body);
    const accepted = recordClientEvents(req, payload.events);
    res.status(202).json({ accepted });
  }),
);
