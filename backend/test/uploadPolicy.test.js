const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  isAllowedAttachmentUpload,
  isAllowedImageUpload,
  isAllowedPngUpload,
  isAllowedStoredUploadPath,
  hasValidUploadContent,
  safeUploadExtension,
  ensureUploadStorageCapacity,
} = require('../dist/utils/uploadPolicy');
const { config } = require('../dist/config');

test('accepts supported raster images when extension and MIME agree', () => {
  assert.equal(isAllowedImageUpload('photo.PNG', 'image/png'), true);
  assert.equal(isAllowedImageUpload('photo.jpeg', 'image/jpeg'), true);
  assert.equal(isAllowedPngUpload('emoji.png', 'image/png'), true);
});

test('checks file signatures instead of trusting multipart metadata', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-upload-policy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const fakePng = path.join(dir, 'fake.png');
  const realPng = path.join(dir, 'real.png');
  const fakePdf = path.join(dir, 'fake.pdf');
  const realPdf = path.join(dir, 'real.pdf');
  fs.writeFileSync(fakePng, '<script>alert(1)</script>');
  fs.writeFileSync(realPng, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
  fs.writeFileSync(fakePdf, '<html><script>alert(1)</script></html>');
  fs.writeFileSync(realPdf, '%PDF-1.4\n%%EOF\n');

  assert.equal(await hasValidUploadContent(fakePng, 'fake.png'), false);
  assert.equal(await hasValidUploadContent(realPng, 'real.png'), true);
  assert.equal(await hasValidUploadContent(fakePdf, 'fake.pdf'), false);
  assert.equal(await hasValidUploadContent(realPdf, 'real.pdf'), true);
});

test('rejects active formats and mismatched image metadata', () => {
  assert.equal(isAllowedImageUpload('payload.svg', 'image/svg+xml'), false);
  assert.equal(isAllowedImageUpload('payload.html', 'image/png'), false);
  assert.equal(isAllowedImageUpload('payload.png', 'text/html'), false);
  assert.equal(isAllowedPngUpload('payload.html', 'image/png'), false);
  assert.equal(isAllowedPngUpload('payload.png', 'text/html'), false);
});

test('accepts supported documents but rejects extension or MIME aliases that do not agree', () => {
  assert.equal(isAllowedAttachmentUpload('manual.pdf', 'application/pdf'), true);
  assert.equal(isAllowedAttachmentUpload('table.csv', 'text/plain; charset=utf-8'), true);
  assert.equal(isAllowedAttachmentUpload('payload.html', 'application/pdf'), false);
  assert.equal(isAllowedAttachmentUpload('payload.pdf', 'text/html'), false);
  assert.equal(isAllowedAttachmentUpload('payload.svg', 'image/svg+xml'), false);
});

test('only preserves extensions covered by the serving policy', () => {
  assert.equal(safeUploadExtension('PHOTO.JPEG'), '.jpeg');
  assert.equal(safeUploadExtension('manual.pdf'), '.pdf');
  assert.equal(safeUploadExtension('payload.svg'), '');
  assert.equal(safeUploadExtension('payload.html'), '');
});

test('refuses active and unknown legacy extensions at the read boundary', () => {
  assert.equal(isAllowedStoredUploadPath('/emojis/ok.png'), true);
  assert.equal(isAllowedStoredUploadPath('/manual.pdf'), true);
  assert.equal(isAllowedStoredUploadPath('/legacy-without-extension'), true);
  assert.equal(isAllowedStoredUploadPath('/payload.svg'), false);
  assert.equal(isAllowedStoredUploadPath('/payload.html'), false);
  assert.equal(isAllowedStoredUploadPath('/payload.xhtml'), false);
});

function capacityResponse() {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.status = (code) => { response.statusCode = code; return response; };
  response.json = (body) => { response.body = body; return response; };
  return response;
}

test('refuses unbounded or over-capacity multipart uploads before writing', async (t) => {
  const originalDir = config.UPLOADS_DIR;
  const originalLimit = config.UPLOADS_MAX_BYTES;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-upload-capacity-'));
  config.UPLOADS_DIR = dir;
  config.UPLOADS_MAX_BYTES = 6;
  t.after(() => {
    config.UPLOADS_DIR = originalDir;
    config.UPLOADS_MAX_BYTES = originalLimit;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const unknownLength = capacityResponse();
  await ensureUploadStorageCapacity({ headers: {} }, unknownLength, () => { throw new Error('must not continue'); });
  assert.equal(unknownLength.statusCode, 413);

  fs.writeFileSync(path.join(dir, 'existing'), '12345');
  const full = capacityResponse();
  await ensureUploadStorageCapacity({ headers: { 'content-length': '2' } }, full, () => { throw new Error('must not continue'); });
  assert.equal(full.statusCode, 507);
});
