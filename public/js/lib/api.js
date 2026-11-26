// The API client. Every call sends X-Requested-With (the Worker's CSRF check) and turns errors into ApiError with
// the server's friendly message, so views can show it as is.

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'x-requested-with': 'mrp', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'You seem to be offline. Check your connection and try again.');
  }
  // Access session expired: the edge redirects to the login page (opaque) or the Worker answers 401.
  if (res.status === 401 || res.type === 'opaqueredirect' || res.redirected) {
    location.reload();
    throw new ApiError(401, 'Your sign-in expired. Reloading…');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Something went wrong (${res.status}).`, data);
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
};

/**
 * Upload a file to a request with progress. Returns the request payload (like GET /api/requests/:ref).
 *   upload(ref, file, { kind: 'reference'|'deliverable', onProgress: (0..1) => {} })
 */
export function upload(ref, file, { kind = 'reference', onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/requests/${encodeURIComponent(ref)}/files?kind=${kind}&name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('x-requested-with', 'mrp');
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error || 'The upload failed.', data));
    };
    xhr.onerror = () => reject(new ApiError(0, 'The upload failed. Check your connection.'));
    xhr.send(file);
  });
}

export const MAX_UPLOAD = 95 * 1024 * 1024;
