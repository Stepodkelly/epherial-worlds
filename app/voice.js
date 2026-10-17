async function post(url, body) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) return { error: true };
    const data = await response.json();
    if (!data || typeof data !== 'object') return { error: true };
    return data;
  } catch {
    return { error: true };
  }
}

export async function requestName(body) {
  return post('/api/name', body);
}

export async function requestSequence(body) {
  return post('/api/sequence', body);
}
