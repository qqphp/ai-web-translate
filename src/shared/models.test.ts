import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModels, ModelListError } from "./models";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("fetchModels", () => {
  it.each([
    ["https://api.openai.com/v1", "https://api.openai.com/v1/models"],
    ["https://relay.example/openai/v1/", "https://relay.example/openai/v1/models"],
    ["https://relay.example/api", "https://relay.example/api/models"],
    ["https://relay.example", "https://relay.example/models"]
  ])("requests models under %s and returns sorted unique IDs", async (baseUrl, expectedUrl) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "z-model" }, { id: "a-model" }, { id: "a-model" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchModels(baseUrl, "secret")).resolves.toEqual(["a-model", "z-model"]);
    expect(fetchMock).toHaveBeenCalledWith(new URL(expectedUrl), expect.objectContaining({ headers: { Authorization: "Bearer secret" } }));
  });

  it("rejects unsupported model-list responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })));
    await expect(fetchModels("https://api.example.com/v1", "secret")).rejects.toBeInstanceOf(ModelListError);
  });

  it("rejects an empty model list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }))));
    await expect(fetchModels("https://relay.example/v1", "secret")).rejects.toThrow("No models are available");
  });

  it("does not expose service responses or keys in authentication errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied secret", { status: 401 })));
    await expect(fetchModels("https://relay.example/v1", "secret")).rejects.toThrow("401");
    await expect(fetchModels("https://relay.example/v1", "secret")).rejects.not.toThrow("secret");
  });

  it("times out stalled model requests", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const assertion = expect(fetchModels("https://relay.example/v1", "secret")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
