// Конфигурация сервера. Ключ API читается только здесь и в браузер не попадает.

export interface ServerConfig {
  port: number;
  host: string;
  apiKey: string | undefined;
  model: string;
  effort: 'low' | 'medium' | 'high';
  requestTimeoutMs: number;
  /** Ограничение частоты запросов к модели: защита от случайного разгона счёта. */
  maxLlmRequestsPerMinute: number;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readConfig(): ServerConfig {
  const effort = process.env.WOTG_LLM_EFFORT;
  return {
    port: num(process.env.PORT, 8080),
    host: process.env.HOST ?? '0.0.0.0',
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    model: process.env.WOTG_LLM_MODEL ?? 'claude-opus-5',
    effort: effort === 'low' || effort === 'high' ? effort : 'medium',
    requestTimeoutMs: num(process.env.WOTG_LLM_TIMEOUT_MS, 30_000),
    maxLlmRequestsPerMinute: num(process.env.WOTG_LLM_RPM, 60),
  };
}
