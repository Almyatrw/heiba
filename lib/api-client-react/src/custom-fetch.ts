export async function customFetch(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, init as any);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fetch error: ${res.status} ${res.statusText} ${text}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return undefined;
}
