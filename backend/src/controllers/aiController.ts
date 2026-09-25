import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { aiEnabled, organizeMarkdown, AiUnavailableError } from '../ai/openaiClient';
import { logError } from '../utils/logger';

const MAX_MARKDOWN_BYTES = 200 * 1024;

export async function aiStatus(_req: AuthRequest, res: Response): Promise<void> {
  res.json({ enabled: aiEnabled() });
}

export async function aiOrganizePage(req: AuthRequest, res: Response): Promise<void> {
  const markdown = typeof req.body?.markdown === 'string' ? req.body.markdown : null;
  if (!markdown || !markdown.trim()) {
    res.status(400).json({ error: 'markdown obrigatório' });
    return;
  }
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
    res.status(413).json({ error: 'markdown muito grande' });
    return;
  }
  try {
    const out = await organizeMarkdown(markdown);
    res.json({ markdown: out });
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      logError('ai.organize.error', { detail: error.message });
      res.status(error.statusCode).json({
        error: error.statusCode === 503 ? 'IA não configurada' : 'Falha ao contatar a IA',
      });
      return;
    }
    logError('ai.organize.error', {
      detail: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Falha ao organizar' });
  }
}
