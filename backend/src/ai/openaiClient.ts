import { config } from '../config/index';

export class AiUnavailableError extends Error {
  constructor(message: string, public readonly statusCode: number = 502) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export function aiEnabled(): boolean {
  return Boolean(config.OPENAI_API_KEY);
}

const SYSTEM_PROMPT = [
  'Você reorganiza notas em Markdown. Regras:',
  '(1) NÃO invente, remova ou reescreva o conteúdo — apenas reestruture.',
  '(2) Ajuste a hierarquia de títulos (#, ##, ###) para refletir a estrutura lógica, sem pular níveis.',
  '(3) Agrupe parágrafos relacionados sob subtítulos quando fizer sentido.',
  '(4) Preserve listas, tabelas, blocos de código, links e imagens exatamente.',
  '(5) Preserve QUALQUER linha do tipo ⟦brain-node:N⟧ intacta e na mesma posição relativa.',
  '(6) Responda só com o Markdown final, sem comentários nem cercas de código ao redor.',
].join(' ');

export async function organizeMarkdown(markdown: string): Promise<string> {
  if (!aiEnabled()) throw new AiUnavailableError('IA não configurada', 503);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.OPENAI_ORGANIZE_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: markdown },
        ],
      }),
    });
    if (!res.ok) {
      throw new AiUnavailableError(`OpenAI HTTP ${res.status}`, 502);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const out = data.choices?.[0]?.message?.content?.trim();
    if (!out) throw new AiUnavailableError('Resposta vazia da IA', 502);
    return out;
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;
    throw new AiUnavailableError(err instanceof Error ? err.message : 'Falha ao contatar a IA', 502);
  } finally {
    clearTimeout(timeout);
  }
}
