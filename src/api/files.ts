// Files in R2: reference material from the requester, deliverables from marketing (one version per delivery round).
// Uploads stream straight to R2. Downloads go through the Worker after a permission check; anything that a browser
// could run (HTML, SVG, scripts) is always downloaded, never shown inline.

import { STATUSES } from '../../public/js/shared/workflow.js';
import { fail, now } from '../lib/http';
import { loadVisible, logEvent } from '../lib/requests';
import { isLead, isMarketing, type Me } from '../lib/users';
import { get } from './requests';

export const MAX_FILE_BYTES = 95 * 1024 * 1024; // Workers accept request bodies up to 100 MB.
const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|video\/(mp4|webm)|audio\/(mpeg|mp4|wav))$/;

function cleanName(name: string) {
  return (
    name
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f/\\]+/g, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 180) || 'file'
  );
}

export async function upload(env: Env, me: Me, ref: string, request: Request, url: URL) {
  const r = await loadVisible(env, me, ref);
  const kind = url.searchParams.get('kind') === 'deliverable' ? 'deliverable' : 'reference';
  const name = cleanName(decodeURIComponent(url.searchParams.get('name') || 'file'));
  const open = STATUSES[r.status as keyof typeof STATUSES]?.open;
  if (!open) fail(400, 'This request is closed. Reopen it to add files.');
  if (kind === 'deliverable') {
    if (!isMarketing(me) || r.status === 'draft') fail(403, 'Only the marketing team can add deliverables.');
  } else if (!(r.requester_email === me.email || isMarketing(me) || r.approver_email === me.email)) {
    fail(403, 'Only people working on this request can add files.');
  }
  const size = Number(request.headers.get('content-length') || 0);
  if (!size) fail(411, 'The file is empty.');
  if (size > MAX_FILE_BYTES) fail(413, 'Files can be up to 95 MB. Share a link (Google Drive, Dropbox) for bigger files.');
  if (!request.body) fail(400, 'The file is empty.');
  const id = crypto.randomUUID();
  const key = `requests/${r.id}/${kind}/${id}`;
  const type = (request.headers.get('content-type') || 'application/octet-stream').slice(0, 120);
  await env.FILES.put(key, request.body, {
    httpMetadata: { contentType: type },
    customMetadata: { name, uploadedBy: me.email, request: r.ref },
  });
  const version = kind === 'deliverable' ? r.revision_count + 1 : 1;
  await env.DB.prepare(
    'INSERT INTO files (id, request_id, kind, name, content_type, size, r2_key, version, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, r.id, kind, name, type, size, key, version, me.email, now())
    .run();
  if (r.status !== 'draft') await logEvent(env, r, me.email, 'file_added', r.status, r.status, { name, kind, version });
  return get(env, me, r.ref, 201);
}

export async function download(env: Env, me: Me, id: string, url: URL) {
  const f = await env.DB.prepare('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL').bind(id).first<any>();
  if (!f) fail(404, 'File not found.');
  await loadVisible(env, me, String(f.request_id));
  const obj = await env.FILES.get(f.r2_key);
  if (!obj) fail(404, 'File not found.');
  const inline = url.searchParams.get('inline') === '1' && INLINE.test(f.content_type || '');
  const ascii = f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return new Response(obj.body, {
    headers: {
      'content-type': inline ? f.content_type : 'application/octet-stream',
      'content-length': String(obj.size),
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'cache-control': 'private, max-age=3600',
      'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function removeFile(env: Env, me: Me, id: string) {
  const f = await env.DB.prepare('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL').bind(id).first<any>();
  if (!f) fail(404, 'File not found.');
  const r = await loadVisible(env, me, String(f.request_id));
  if (f.uploaded_by !== me.email && !isLead(me)) fail(403, 'Only the person who added a file (or a marketing lead) can remove it.');
  await env.DB.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').bind(now(), id).run();
  await env.FILES.delete(f.r2_key);
  if (r.status !== 'draft') await logEvent(env, r, me.email, 'file_removed', r.status, r.status, { name: f.name, kind: f.kind });
  return get(env, me, r.ref);
}
