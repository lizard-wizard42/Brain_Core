import { describe, expect, it } from 'vitest';
import { resolveAttachmentUrl } from './assetUrl';

describe('resolveAttachmentUrl', () => {
  it('accepts local uploads and legacy base prefixes', () => {
    const origin = window.location.origin;
    expect(resolveAttachmentUrl('/uploads/report.pdf')).toBe(`${origin}/uploads/report.pdf`);
    expect(resolveAttachmentUrl('/old-base/uploads/report.pdf')).toBe(`${origin}/uploads/report.pdf`);
    expect(resolveAttachmentUrl(`${origin}/uploads/report.pdf`)).toBe(`${origin}/uploads/report.pdf`);
    expect(resolveAttachmentUrl('/uploads/folder/my%20report.pdf')).toBe(`${origin}/uploads/folder/my%20report.pdf`);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://evil.example/uploads/report.pdf',
    '//evil.example/uploads/report.pdf',
    '/uploads/../admin',
    '/uploads/%2e%2e/admin',
    '/uploads/%2fadmin',
    '/uploads/file.pdf?next=https://evil.example',
    '/uploads/file.pdf#fragment',
    '/uploads\\file.pdf',
    '/admin/uploads/file.pdf/../../admin',
    '/uploads/',
  ])('rejects untrusted or ambiguous URL %s', rawUrl => {
    expect(resolveAttachmentUrl(rawUrl)).toBeNull();
  });
});
