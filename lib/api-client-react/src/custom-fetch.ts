// Error type alias used by generated hooks (orval mutator contract)
export type ErrorType<TError> = TError;

export async function customFetch<TResponse>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<TResponse> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fetch error: ${res.status} ${res.statusText} ${text}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as TResponse;
  }
  return undefined as TResponse;
}
