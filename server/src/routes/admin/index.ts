import { Router } from 'express';
import { adminAnnouncementsRouter } from './announcements';
import { adminExtensionsRouter } from './extensions';
import { adminLogsRouter } from './logs';
import { adminMarketplaceRouter } from './marketplace';
import { adminOverviewRouter } from './overview';
import { adminRemoteRouter } from './remote';
import { adminSettingsRouter } from './settings';
import { adminStorageRouter } from './storage';
import { adminTasksRouter } from './tasks';
import { adminVscodeRouter } from './vscode';

export const adminRouter = Router();

adminRouter.use('/', adminOverviewRouter);
adminRouter.use('/', adminVscodeRouter);
adminRouter.use('/announcements', adminAnnouncementsRouter);
adminRouter.use('/extensions', adminExtensionsRouter);
adminRouter.use('/marketplace', adminMarketplaceRouter);
adminRouter.use('/remote', adminRemoteRouter);
adminRouter.use('/tasks', adminTasksRouter);
adminRouter.use('/storage', adminStorageRouter);
adminRouter.use('/', adminLogsRouter);
adminRouter.use('/settings', adminSettingsRouter);
