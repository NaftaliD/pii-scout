FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN npm --prefix web ci && npm --prefix web run build
RUN npm --prefix server ci && npm --prefix server run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json server/
RUN npm --prefix server ci --omit=dev
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
CMD ["node", "server/dist/index.js"]
