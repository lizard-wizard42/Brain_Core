import type { ContactSummary, InfiniteDoc, PageGrant, PageShareRole, PageVersion, SharedPageSummary, TiptapDoc, TiptapNode } from '../../types';

export interface SharedBucket {
  received: SharedPageSummary[];
  sent: SharedPageSummary[];
}

/**
 * Removes any page that appears in both buckets (it must be shown only once)
 * and drops duplicates inside a bucket, keeping the first (most recent) entry.
 * Received wins over sent so a page shared with me never leaks into "by me".
 */
export function mergeSharedPages(received: SharedPageSummary[], sent: SharedPageSummary[]): SharedBucket {
  const seen = new Set<string>();
  const dedupe = (list: SharedPageSummary[]) => {
    const out: SharedPageSummary[] = [];
    for (const item of list) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  };
  const dedupedReceived = dedupe(received);
  const dedupedSent = dedupe(sent);
  return { received: dedupedReceived, sent: dedupedSent };
}

export function filterSharedPages(list: SharedPageSummary[], query: string): SharedPageSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((page) => page.title.toLowerCase().includes(needle));
}

export function roleLabel(role: PageShareRole): string {
  switch (role) {
    case 'owner': return 'Dono';
    case 'editor': return 'Pode editar';
    case 'viewer': return 'Pode ler';
    default: return role;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function resolveAuthorName(version: PageVersion | undefined, nameById: Map<string, string>): string | null {
  if (!version) return null;
  if (version.author_name) return version.author_name;
  const byId = version.author_user_id ? nameById.get(version.author_user_id) : undefined;
  return byId ?? null;
}

export function describeLastEdit(version: PageVersion | undefined, fallbackIso: string | null | undefined, nameById: Map<string, string>): string {
  const when = formatDateTime(version?.created_at ?? fallbackIso);
  if (!when) return '';
  const author = resolveAuthorName(version, nameById);
  return author ? `Última alteração por ${author} em ${when}` : `Última alteração em ${when}`;
}

function nodeText(node: TiptapNode): string {
  if (typeof node.text === 'string') return node.text;
  if (!node.content) return '';
  return node.content.map(nodeText).join('');
}

/** Plain-text blocks (one per top-level node) so a change summary stays readable. */
export function contentToBlocks(content: TiptapDoc | InfiniteDoc | undefined | null): string[] {
  if (!content || !('type' in content) || content.type !== 'doc') return [];
  return content.content.map((node) => nodeText(node).trim()).filter((text) => text.length > 0);
}

export interface DiffSummary {
  added: number;
  removed: number;
  unchanged: number;
  label: string;
}

/** Block-level summary of what changed between a previous and the current snapshot. */
export function summarizeDiff(previous: TiptapDoc | InfiniteDoc | undefined | null, current: TiptapDoc | InfiniteDoc | undefined | null): DiffSummary {
  const before = contentToBlocks(previous);
  const after = contentToBlocks(current);

  const lcs = longestCommonSubsequence(before, after);
  const added = after.length - lcs;
  const removed = before.length - lcs;
  const unchanged = lcs;

  if (added === 0 && removed === 0) {
    return { added, removed, unchanged, label: 'Sem mudanças de texto relevantes' };
  }
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} ${added === 1 ? 'trecho adicionado' : 'trechos adicionados'}`);
  if (removed > 0) parts.push(`${removed} ${removed === 1 ? 'trecho removido' : 'trechos removidos'}`);
  return { added, removed, unchanged, label: parts.join(' · ') };
}

function longestCommonSubsequence(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return previous[b.length];
}

export function grantsToNameMap(grants: PageGrant[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const grant of grants) {
    const name = grant.name?.trim() || grant.email?.trim();
    if (name) map.set(grant.user_id, name);
  }
  return map;
}

export function grantDisplayName(grant: PageGrant): string {
  return grant.name?.trim() || grant.email?.trim() || 'Pessoa sem nome';
}

export function contactDisplayName(contact: ContactSummary): string {
  return contact.name?.trim() || contact.email;
}

/** Backend errors arrive as `API <status>: {"error": "..."}`; surface the server message when possible. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const match = err.message.match(/^API \d+: (.*)$/s);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]) as { error?: unknown };
      if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    } catch {
      return err.message;
    }
  }
  return err.message;
}
