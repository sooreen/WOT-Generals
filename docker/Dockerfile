# Многоступенчатая сборка: тяжёлые зависимости остаются в стадии сборки,
# в финальный образ попадают только клиент, серверный код и игровые данные.

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

# Сначала манифесты — слой с зависимостями кешируется, пока они не изменились.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/ai/package.json packages/ai/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile || pnpm install

COPY . .
RUN pnpm --filter @wotg/web build

# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
# Данные и арты карт: без них игра не запустится.
COPY --from=build /app/data ./data

# Зависимости ставятся от root: pnpm требует прав на свой store и corepack.
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

# Работать сервер должен не от root. Пользователь node уже есть в базовом образе,
# а отдельный chown -R не нужен: приложение только читает свои файлы.
USER node

EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["pnpm", "--filter", "@wotg/server", "start"]
