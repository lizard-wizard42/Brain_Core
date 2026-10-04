export function validDocument(value: unknown): boolean {
  const nodes = new Set(['doc','paragraph','text','heading','blockquote','codeBlock','hardBreak','bulletList',
    'orderedList','listItem','horizontalRule','table','tableRow','tableHeader','tableCell','taskList','taskItem',
    'image','subPageBlock','attachmentBlock']);
  const marks = new Set(['bold','italic','strike','code','highlight','textStyle','underline','link']);
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const safeUrl = (url: unknown) => typeof url === 'string' && (/^https?:\/\//i.test(url) || /^mailto:/i.test(url) || /^\/(?!\/)/.test(url) || /^#/.test(url));
  const visit = (node: unknown, depth: number): boolean => {
    if (depth > 64 || !object(node) || typeof node.type !== 'string' || !nodes.has(node.type)) return false;
    if (node.attrs !== undefined && !object(node.attrs)) return false;
    if (node.type === 'text' && typeof node.text !== 'string') return false;
    if (node.marks !== undefined && (!Array.isArray(node.marks) || !node.marks.every(mark => object(mark) &&
      typeof mark.type === 'string' && marks.has(mark.type) && (mark.attrs === undefined || object(mark.attrs)) &&
      (mark.type !== 'link' || (object(mark.attrs) && safeUrl(mark.attrs.href)))))) return false;
    if (node.attrs && ['image','attachmentBlock'].includes(node.type)) {
      if (!safeUrl((node.attrs as Record<string, unknown>)[node.type === 'image' ? 'src' : 'url'])) return false;
    }
    return node.content === undefined || (Array.isArray(node.content) && node.content.every(child => visit(child, depth + 1)));
  };
  return object(value) && value.type === 'doc' && Array.isArray(value.content) && visit(value, 0) &&
    Buffer.byteLength(JSON.stringify(value)) <= 256 * 1024;
}
