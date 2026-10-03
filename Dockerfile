FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium
COPY . .
CMD ["node", "services/core/server.mjs"]
