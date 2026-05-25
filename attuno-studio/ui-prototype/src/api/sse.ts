export type ParsedSseEvent = {
  eventName: string;
  data: unknown;
};

export function parseSseEventBlock(rawEvent: string): ParsedSseEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of rawEvent.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return {
    eventName,
    data: JSON.parse(dataLines.join("\n")),
  };
}

export async function* iterateSseEvents(
  response: Response,
  disconnectMessage: string
): AsyncGenerator<ParsedSseEvent> {
  if (!response.body) {
    throw new Error("SSE response body is missing");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read().catch((error) => {
        throw new Error(
          `${disconnectMessage}；原始错误：${error instanceof Error ? error.message : String(error)}`
        );
      });
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.trim()) continue;
        const parsed = parseSseEventBlock(part);
        if (parsed) yield parsed;
      }

      if (done) break;
    }

    if (buffer.trim()) {
      const parsed = parseSseEventBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}
