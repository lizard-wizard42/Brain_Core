import type { TiptapDoc } from '../../types';

const document = (headings: string[]): TiptapDoc => ({ type: 'doc', content: headings.flatMap(text => [
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] },
  { type: 'paragraph' },
]) });

export const builtInTemplates = [
  { id: 'study', name: 'Estudo', description: 'Conceitos, exemplos e dúvidas para revisar.', content: document(['Objetivo do estudo', 'Conceitos principais', 'Exemplos e aplicações', 'Dúvidas', 'Resumo e revisão']) },
  { id: 'meeting', name: 'Reunião', description: 'Pauta, decisões e próximos passos.', content: document(['Objetivo e participantes', 'Pauta', 'Anotações', 'Decisões', 'Próximos passos e responsáveis']) },
  { id: 'project', name: 'Projeto', description: 'Objetivo, escopo, entregas e acompanhamento.', content: document(['Objetivo', 'Escopo', 'Entregas', 'Tarefas e responsáveis', 'Riscos e dúvidas', 'Acompanhamento']) },
];
