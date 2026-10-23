import { Router, Request, Response } from 'express';
import {
  AI_BUSY_MESSAGE,
  AI_UNAVAILABLE_MESSAGE,
  askSiteAssistant,
  buildSiteSummary,
} from '../services/geminiService.ts';

export const aiRouter = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/sites/:siteId/assistant/summary
aiRouter.get('/sites/:siteId/assistant/summary', async (req: Request, res: Response) => {
  const { siteId } = req.params;
  if (!siteId || !UUID_REGEX.test(siteId)) {
    return res.status(400).json({
      error: {
        code: 'invalid_site_id',
        message: 'A valid site ID is required.',
      },
    });
  }
  try {
    const summary = await buildSiteSummary(siteId);
    return res.json({ siteId, summary });
  } catch (err: any) {
    console.error('Failed to build site summary:', err);
    return res.status(500).json({
      error: {
        code: 'summary_error',
        message: 'Could not load site summary.',
      },
    });
  }
});

// POST /api/sites/:siteId/assistant
aiRouter.post('/sites/:siteId/assistant', async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const { question, history } = req.body || {};

  if (!siteId || !UUID_REGEX.test(siteId)) {
    return res.status(400).json({
      error: {
        code: 'invalid_site_id',
        message: 'A valid site ID is required.',
      },
    });
  }

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({
      error: {
        code: 'invalid_question',
        message: 'Please enter a question.',
      },
    });
  }

  try {
    const result = await askSiteAssistant({
      siteId,
      question: question.trim(),
      history: Array.isArray(history) ? history : [],
    });

    return res.json({
      siteId,
      answer: result.answer,
      suggestedAction: result.suggestedAction,
      aiAvailable: true,
    });
  } catch (err: any) {
    const isBusy = Boolean(err?.isBusy);
    const message = isBusy ? AI_BUSY_MESSAGE : AI_UNAVAILABLE_MESSAGE;
    return res.status(200).json({
      siteId,
      answer: message,
      suggestedAction: 'Keep an eye on the Network Health tab over the next few minutes.',
      aiAvailable: false,
      error: {
        code: isBusy ? 'ai_busy' : 'ai_unavailable',
        message,
      },
    });
  }
});
