export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  let data = {};
  try {
    data = await res.json();
  } catch {
    // non-JSON response body
  }
  if (!res.ok) {
    // Every thrown error is tagged with the endpoint that raised it, so a
    // bare "Request failed (500)" surfacing anywhere in the UI (banners,
    // alerts, etc.) still tells you which backend call is the culprit.
    const method = (options?.method || 'GET').toUpperCase();
    const endpoint = url.split('?')[0];
    const detail = data.error || `Request failed (${res.status})`;
    throw new Error(`[${method} ${endpoint}] ${detail}`);
  }
  return data;
}
