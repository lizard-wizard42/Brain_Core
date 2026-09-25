/**
 * Import script: data/markdown/*.md → PostgreSQL (Tiptap JSONB)
 * Run: npx ts-node scripts/import-md.ts
 * Safe to run multiple times (idempotent via ON CONFLICT DO NOTHING)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { Lexer, Token } from 'marked';

// ─── Database ──────────────────────────────────────────────────────────────

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'brain_core_db',
  user: process.env.DB_USER || 'brain_core_app',
  password: process.env.DB_PASSWORD || '',
});

const MD_ROOT = process.env.MD_SOURCE_PATH || path.join(__dirname, '../../data/markdown');

// ─── Tiptap node types ──────────────────────────────────────────────────────

interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

interface TiptapDoc {
  type: 'doc';
  content: TiptapNode[];
}

// ─── Markdown → Tiptap conversion ──────────────────────────────────────────

function textNode(text: string, marks: TiptapMark[] = []): TiptapNode {
  const node: TiptapNode = { type: 'text', text };
  if (marks.length > 0) node.marks = marks;
  return node;
}

function parseInlineTokens(tokens: Token[]): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  for (const tok of tokens) {
    if (tok.type === 'text') {
      nodes.push(textNode((tok as { text: string }).text));
    } else if (tok.type === 'strong') {
      const inner = parseInlineTokens((tok as { tokens?: Token[] }).tokens || []);
      nodes.push(...inner.map(n => ({ ...n, marks: [...(n.marks || []), { type: 'bold' }] })));
    } else if (tok.type === 'em') {
      const inner = parseInlineTokens((tok as { tokens?: Token[] }).tokens || []);
      nodes.push(...inner.map(n => ({ ...n, marks: [...(n.marks || []), { type: 'italic' }] })));
    } else if (tok.type === 'codespan') {
      nodes.push(textNode((tok as { text: string }).text, [{ type: 'code' }]));
    } else if (tok.type === 'link') {
      const linkTok = tok as { href: string; tokens?: Token[] };
      const inner = parseInlineTokens(linkTok.tokens || []);
      nodes.push(...inner.map(n => ({
        ...n,
        marks: [...(n.marks || []), { type: 'link', attrs: { href: linkTok.href } }]
      })));
    } else if (tok.type === 'escape') {
      nodes.push(textNode((tok as { text: string }).text));
    } else if (tok.type === 'br') {
      nodes.push({ type: 'hardBreak' });
    }
  }
  return nodes;
}

function convertTokens(tokens: Token[]): TiptapNode[] {
  const nodes: TiptapNode[] = [];

  for (const tok of tokens) {
    switch (tok.type) {
      case 'heading': {
        const h = tok as { depth: number; tokens?: Token[] };
        nodes.push({
          type: 'heading',
          attrs: { level: h.depth },
          content: parseInlineTokens(h.tokens || []),
        });
        break;
      }

      case 'paragraph': {
        const p = tok as { tokens?: Token[] };
        const content = parseInlineTokens(p.tokens || []);
        if (content.length > 0) {
          nodes.push({ type: 'paragraph', content });
        }
        break;
      }

      case 'blockquote': {
        const bq = tok as { tokens?: Token[] };
        nodes.push({
          type: 'blockquote',
          content: convertTokens(bq.tokens || []),
        });
        break;
      }

      case 'code': {
        const c = tok as { text: string; lang?: string };
        nodes.push({
          type: 'codeBlock',
          attrs: { language: c.lang || null },
          content: [{ type: 'text', text: c.text }],
        });
        break;
      }

      case 'list': {
        const list = tok as { ordered: boolean; items: { tokens?: Token[]; checked?: boolean | null; task?: boolean }[] };
        if (list.items.some(i => i.task)) {
          // Task list
          nodes.push({
            type: 'taskList',
            content: list.items.map(item => ({
              type: 'taskItem',
              attrs: { checked: item.checked === true },
              content: convertTokens(item.tokens || []),
            })),
          });
        } else if (list.ordered) {
          nodes.push({
            type: 'orderedList',
            content: list.items.map(item => ({
              type: 'listItem',
              content: convertTokens(item.tokens || []),
            })),
          });
        } else {
          nodes.push({
            type: 'bulletList',
            content: list.items.map(item => ({
              type: 'listItem',
              content: convertTokens(item.tokens || []),
            })),
          });
        }
        break;
      }

      case 'table': {
        const t = tok as {
          header: { tokens?: Token[] }[];
          rows: { tokens?: Token[] }[][];
        };
        const headerCells = t.header.map(cell => ({
          type: 'tableHeader',
          content: [{ type: 'paragraph', content: parseInlineTokens(cell.tokens || []) }],
        }));
        const bodyRows = t.rows.map(row => ({
          type: 'tableRow',
          content: row.map(cell => ({
            type: 'tableCell',
            content: [{ type: 'paragraph', content: parseInlineTokens(cell.tokens || []) }],
          })),
        }));
        nodes.push({
          type: 'table',
          content: [
            { type: 'tableRow', content: headerCells },
            ...bodyRows,
          ],
        });
        break;
      }

      case 'hr': {
        nodes.push({ type: 'horizontalRule' });
        break;
      }

      case 'space': {
        // skip
        break;
      }

      case 'html': {
        // skip raw HTML blocks
        break;
      }

      default: {
        // Fallback: try to extract text
        const fallback = tok as { text?: string };
        if (fallback.text) {
          nodes.push({ type: 'paragraph', content: [textNode(fallback.text)] });
        }
      }
    }
  }

  return nodes;
}

function markdownToTiptap(markdown: string): TiptapDoc {
  const lexer = new Lexer({ gfm: true, breaks: false });
  const tokens = lexer.lex(markdown);
  const content = convertTokens(tokens as Token[]);
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }] };
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

async function upsertFolder(
  name: string,
  slug: string,
  parentId: string | null,
  sortOrder: number
): Promise<string> {
  const client = await pool.connect();
  try {
    // Try insert, ignore conflict on (parent_id, slug)
    const res = await client.query<{ id: string }>(
      `INSERT INTO folders (name, slug, parent_id, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (parent_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [name, slug, parentId, sortOrder]
    );
    return res.rows[0].id;
  } finally {
    client.release();
  }
}

async function upsertPage(
  folderId: string,
  title: string,
  slug: string,
  content: TiptapDoc,
  markdownSource: string,
  sortOrder: number
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO pages (folder_id, title, slug, content, markdown_source, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (folder_id, slug) DO NOTHING`,
      [folderId, title, slug, JSON.stringify(content), markdownSource, sortOrder]
    );
  } finally {
    client.release();
  }
}

// ─── File system walk ────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.md$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/^\d+\s*/, '') // remove leading numbers like "01 " or "01-"
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function processDirectory(
  dirPath: string,
  parentId: string | null,
  sortOrder: number
): Promise<{ folders: number; pages: number }> {
  let totalFolders = 0;
  let totalPages = 0;

  const dirName = path.basename(dirPath);
  const slug = toSlug(dirName);

  // Create folder for this directory
  const folderId = await upsertFolder(dirName, slug, parentId, sortOrder);
  totalFolders++;
  console.log(`  [folder] ${parentId ? '  ' : ''}${dirName} → ${folderId}`);

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
  const files = entries.filter(e => e.isFile() && e.name.endsWith('.md'));

  // Process subdirectories
  for (let i = 0; i < dirs.length; i++) {
    const subPath = path.join(dirPath, dirs[i].name);
    const sub = await processDirectory(subPath, folderId, i);
    totalFolders += sub.folders;
    totalPages += sub.pages;
  }

  // Process .md files
  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(dirPath, files[i].name);
    const markdownSource = fs.readFileSync(filePath, 'utf-8');
    const content = markdownToTiptap(markdownSource);
    const fileSlug = toSlug(files[i].name.replace(/\.md$/i, ''));
    const title = titleFromFilename(files[i].name);

    await upsertPage(folderId, title, fileSlug, content, markdownSource, i);
    totalPages++;
    console.log(`    [page]  ${files[i].name} → "${title}"`);
  }

  return { folders: totalFolders, pages: totalPages };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Brain Core — Markdown Import');
  console.log(`Source: ${MD_ROOT}`);
  console.log('─'.repeat(60));

  if (!fs.existsSync(MD_ROOT)) {
    console.error(`ERROR: Source path not found: ${MD_ROOT}`);
    process.exit(1);
  }

  // Test DB connection
  try {
    await pool.query('SELECT 1');
    console.log('Database connected OK\n');
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }

  // Walk root: each top-level directory becomes a root folder
  const entries = fs.readdirSync(MD_ROOT, { withFileTypes: true });
  const topDirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  let totalFolders = 0;
  let totalPages = 0;

  for (let i = 0; i < topDirs.length; i++) {
    const dirPath = path.join(MD_ROOT, topDirs[i].name);
    const result = await processDirectory(dirPath, null, i);
    totalFolders += result.folders;
    totalPages += result.pages;
  }

  // Also import .md files at the root level (e.g. README.md)
  const rootFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
  if (rootFiles.length > 0) {
    // Create a special "root" folder if needed, but skip for now
    console.log(`\n[info] ${rootFiles.length} .md files at root level skipped (no folder context)`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`Import complete: ${totalFolders} folders, ${totalPages} pages`);

  await pool.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
