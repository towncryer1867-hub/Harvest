export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  let data = {};
  try {
    data = await res.json();
  } catch {
    // non-JSON response body
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}
