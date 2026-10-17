import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanTranslation, parseBatchOutput, translate, translateBatch, translateStreaming } from "./api";
import type { Profile } from "./types";

const profile: Profile = { id: "p", name: "Test", baseUrl: "https://api.example.com/v1", apiKey: "secret", model: "demo", sourceLanguage: "English", targetLanguage: "Chinese", mode: "replace" };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("cleanTranslation", () => {
  it("removes common wrappers without changing translated prose", () => {
    expect(cleanTranslation('"Translation: Hello world"')).toBe("Hello world");
    expect(cleanTranslation("```text\n你好\n``` ")).toBe("你好");
  });
});

describe("parseBatchOutput", () => {
  it("keeps translations aligned to their source node IDs", () => {
    const result = parseBatchOutput('[{"id":"a","translation":"你好"},{"id":"b","translation":"世界"}]', [{ id: "a", text: "Hello" }, { id: "b", text: "World" }]);
    expect(result.get("a")).toBe("你好");
    expect(result.get("b")).toBe("世界");
  });
  it("rejects malformed or incomplete model output", () => {
    expect(() => parseBatchOutput("not json", [{ id: "a", text: "Hello" }])).toThrow(/invalid batch/);
    expect(() => parseBatchOutput('[]', [{ id: "a", text: "Hello" }])).toThrow(/incomplete/);
  });
});

describe("Chat Completions client", () => {
  it("uses the compact plain-text protocol for a single page node", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: "你好" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await translateBatch(profile, [{ id: "node-0", text: "Hello" }]);
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(result.get("node-0")).toBe("你好");
    expect(request.messages).toHaveLength(2);
    expect(request.messages.map((message: { content: string }) => message.content).join("\n")).not.toContain("JSON");
    expect(JSON.stringify(request).length).toBeLessThan(400);
  });

  it("uses a non-streaming request and parses the assistant message", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: "你好" } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(translate(profile, "Hello")).resolves.toBe("你好");
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(request).toMatchObject({ model: "demo", stream: false });
    expect(Object.keys(request).sort()).toEqual(["messages", "model", "stream"]);
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it.each([
    ["https://api.openai.com/v1", "https://api.openai.com/v1/chat/completions"],
    ["https://relay.example/openai/v1/", "https://relay.example/openai/v1/chat/completions"],
    ["https://relay.example/api", "https://relay.example/api/chat/completions"],
    ["https://relay.example", "https://relay.example/chat/completions"]
  ])("uses the exact API prefix %s without adding vendor-specific fields", async (baseUrl, expectedUrl) => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: "你好" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await translate({ ...profile, baseUrl }, "Hello");
    expect(String(fetch.mock.calls[0][0])).toBe(expectedUrl);
    expect(Object.keys(JSON.parse(String(fetch.mock.calls[0][1]?.body))).sort()).toEqual(["messages", "model", "stream"]);
  });

  it("streams partial text for faster selected-text feedback", async () => {
    const payload = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      "data: [DONE]\n\n"
    ].join("");
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(payload, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const partials: string[] = [];
    await expect(translateStreaming(profile, "Hello", (text) => partials.push(text))).resolves.toBe("你好");
    expect(partials).toEqual(["你", "你好"]);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ stream: true });
    expect(Object.keys(JSON.parse(String(fetch.mock.calls[0][1]?.body))).sort()).toEqual(["messages", "model", "stream"]);
  });

  it("retains a relay prefix for streaming requests and accepts a JSON fallback", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: "你好" } }] }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const onText = vi.fn();
    await expect(translateStreaming({ ...profile, baseUrl: "https://relay.example/openai/v1/" }, "Hello", onText)).resolves.toBe("你好");
    expect(String(fetch.mock.calls[0][0])).toBe("https://relay.example/openai/v1/chat/completions");
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(onText).toHaveBeenCalledWith("你好");
  });

  it("decodes UTF-8 and SSE lines split across network chunks", async () => {
    const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
    const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })));
    await expect(translateStreaming(profile, "Hello", vi.fn())).resolves.toBe("你好");
  });

  it("uses the compatible protocol for multiple page nodes", async () => {
    const content = JSON.stringify([{ id: "a", translation: "你好" }, { id: "b", translation: "世界" }]);
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content } }] })));
    vi.stubGlobal("fetch", fetch);
    const result = await translateBatch({ ...profile, baseUrl: "https://relay.example/openai/v1" }, [{ id: "a", text: "Hello" }, { id: "b", text: "World" }]);
    expect([...result.entries()]).toEqual([["a", "你好"], ["b", "世界"]]);
    expect(String(fetch.mock.calls[0][0])).toBe("https://relay.example/openai/v1/chat/completions");
    expect(Object.keys(JSON.parse(String(fetch.mock.calls[0][1]?.body))).sort()).toEqual(["messages", "model", "stream"]);
  });

  it.each([false, true])("preserves timeout and cancellation with stream=%s", async (stream) => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const run = (signal?: AbortSignal) => stream ? translateStreaming(profile, "Hello", vi.fn(), signal) : translate(profile, "Hello", signal);
    const timeoutAssertion = expect(run()).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(60_000);
    await timeoutAssertion;
    const controller = new AbortController();
    const cancelAssertion = expect(run(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await cancelAssertion;
  });

  it("asks the model to detect an automatic source language", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: "Hello" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await translate({ ...profile, sourceLanguage: "auto" }, "Bonjour");
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(request.messages[1].content).toContain("Source: auto-detect");
  });

  it("returns safe errors without exposing the API key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied secret", { status: 401 })));
    await expect(translate(profile, "Hello")).rejects.toThrow("API request failed (401)");
    await expect(translate(profile, "Hello")).rejects.not.toThrow("secret");
  });
});
