export type LocalModel = {
  name: string;
  sizeBytes: number;
  parameterSize: string;
  quantization: string;
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type LocalModelSelection = {
  model: string;
  contextWindow: number;
  thinking: boolean;
  sessionKey?: string;
};

export type LocalModelsState = {
  models: LocalModel[];
  defaultModel?: string;
  contextWindow?: number;
  thinking?: boolean;
};

export function validateLocalModelSelection(input: LocalModelSelection): void {
  if (
    !input ||
    typeof input.model !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(input.model) ||
    /:cloud(?:$|-)/i.test(input.model)
  ) {
    throw new Error("Choose an installed local model.");
  }
  if (![16384, 32768, 65536].includes(input.contextWindow))
    throw new Error("Choose a 16K, 32K, or 64K context.");
  if (typeof input.thinking !== "boolean")
    throw new Error("Choose a response style.");
  if (
    input.sessionKey !== undefined &&
    (typeof input.sessionKey !== "string" ||
      !input.sessionKey ||
      input.sessionKey.length > 512)
  )
    throw new Error("Invalid conversation key.");
}
