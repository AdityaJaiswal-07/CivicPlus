import { Router } from 'express';
import { sendSuccess } from '../utils/response.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  sendSuccess(res, {
    status: 'ok',
    service: 'civicplus-backend',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
