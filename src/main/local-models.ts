import type { LocalModel } from "../shared/local-models.js";

export const LOCAL_OLLAMA_URL = "http://127.0.0.1:11434";

export async function installedLocalModels(
  baseUrl = LOCAL_OLLAMA_URL,
): Promise<LocalModel[]> {
  const response = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(
      "Ollama could not list installed models. Make sure Ollama is running.",
    );
  const tags = (await response.json()) as {
    models?: Array<{
      name: string;
      size: number;
      remote_model?: string;
      remote_host?: string;
      details?: { parameter_size?: string; quantization_level?: string };
    }>;
  };
  const models = await Promise.all(
    (tags.models ?? []).map(async (tag) => {
      if (
        tag.remote_host ||
        tag.remote_model ||
        /:cloud(?:$|-)/i.test(tag.name)
      )
        return null;
      const detailResponse = await fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: tag.name }),
        signal: AbortSignal.timeout(5000),
      });
      // An unavailable detail is an error, never permission to assume local/tool support.
      if (!detailResponse.ok)
        throw new Error(
          `Couldn't inspect ${tag.name}. Refresh the model list and try again.`,
        );
      const detail = (await detailResponse.json()) as {
        capabilities?: string[];
        remote_host?: string;
        remote_model?: string;
      };
      if (detail.remote_host || detail.remote_model) return null;
      return {
        name: tag.name,
        sizeBytes: tag.size,
        parameterSize: tag.details?.parameter_size ?? "",
        quantization: tag.details?.quantization_level ?? "",
        tools: detail.capabilities?.includes("tools") ?? false,
        vision: detail.capabilities?.includes("vision") ?? false,
        reasoning: detail.capabilities?.includes("thinking") ?? false,
      } satisfies LocalModel;
    }),
  );
  return models
    .filter((model): model is LocalModel => model !== null)
    .sort((a, b) => a.sizeBytes - b.sizeBytes);
}
