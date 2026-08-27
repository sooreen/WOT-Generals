// Сервер: раздаёт собранный клиент, ассеты карт и обслуживает режим нейросети.
//
// Игра целиком работает на клиенте — движок и программный ИИ выполняются в браузере.
// Серверу отведена ровно одна игровая обязанность: сходить в API нейросети,
// чтобы ключ не покидал сервер. Всё остальное — статика.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { loadGameData } from '@wotg/shared/node';
import { getLegalActions, makeResolver, type GameState } from '@wotg/engine';
import { LlmAgent } from '@wotg/ai/llm';
import { readConfig } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const WEB_DIST = resolve(ROOT, 'apps/web/dist');
const ASSETS = resolve(ROOT, 'data/assets');

const config = readConfig();
const data = loadGameData();
const resolver = makeResolver(data);

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 4 * 1024 * 1024, // состояние партии — это JSON на десятки килобайт
});

// Простое окно частоты: сервер публичный, а каждый запрос к модели стоит денег.
const requestTimes: number[] = [];
function rateLimitExceeded(): boolean {
  const now = Date.now();
  while (requestTimes.length && now - requestTimes[0]! > 60_000) requestTimes.shift();
  if (requestTimes.length >= config.maxLlmRequestsPerMinute) return true;
  requestTimes.push(now);
  return false;
}

app.get('/api/config', async () => ({
  llmAvailable: Boolean(config.apiKey),
  model: config.apiKey ? config.model : null,
  difficulties: ['recruit', 'sergeant', 'officer', 'general'],
}));

app.get('/api/health', async () => ({ ok: true, cards: data.cards.length }));

app.post<{ Body: { state?: GameState } }>('/api/ai/move', async (request, reply) => {
  const state = request.body?.state;
  if (!state || !Array.isArray(state.players) || typeof state.current !== 'number') {
    return reply.code(400).send({ error: 'Ожидается поле state с состоянием боя' });
  }
  if (!config.apiKey) {
    return reply.code(503).send({ error: 'Режим нейросети выключен: не задан ANTHROPIC_API_KEY' });
  }
  if (rateLimitExceeded()) {
    return reply.code(429).send({ error: 'Слишком часто. Попробуйте через минуту.' });
  }

  // Состояние приходит от клиента, поэтому доверять ему нельзя.
  // Ход всё равно выбирается из списка, который генерирует движок здесь, на сервере.
  const legal = getLegalActions(state, resolver);
  if (!legal.length) return { action: { type: 'endTurn' } };

  let fallbackReason: string | null = null;
  const agent = new LlmAgent({
    apiKey: config.apiKey,
    model: config.model,
    effort: config.effort,
    timeoutMs: config.requestTimeoutMs,
    onFallback: (reason) => {
      fallbackReason = reason;
      app.log.warn({ reason }, 'нейросеть не выбрала ход, работает программный ИИ');
    },
  });

  const action = await agent.chooseAction(state, data);
  return { action, fallbackReason };
});

// Арты карт и иллюстрации.
// Префикс намеренно /art/, а не /assets/: Vite складывает собственные бандлы
// в dist/assets, и совпадение путей перехватывало запросы к JS клиента.
if (existsSync(ASSETS)) {
  await app.register(fastifyStatic, { root: ASSETS, prefix: '/art/', decorateReply: false });
} else {
  app.log.warn('Каталог data/assets не найден: карты будут без изображений');
}

// Собранный клиент. В режиме разработки его нет — тогда работает vite dev server.
if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/' });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Не найдено' });
    return reply.sendFile('index.html');
  });
} else {
  app.log.warn('Клиент не собран (apps/web/dist). Выполните: pnpm --filter @wotg/web build');
}

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `Карт в базе: ${data.cards.length}. Режим нейросети: ${config.apiKey ? `включён (${config.model})` : 'выключен'}`,
);
