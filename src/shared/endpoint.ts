export function apiEndpoint(baseUrl: string, path: "models" | "chat/completions"): URL {
  return new URL(path, `${baseUrl.trim().replace(/\/+$/, "")}/`);
}
