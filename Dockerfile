FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
# Run as the image's built-in unprivileged user rather than root — limits
# what an attacker who achieves code execution inside the container can do
# (e.g. no write access outside /app, can't install system packages).
RUN chown -R node:node /app
USER node
EXPOSE 3000
# migrate deploy is idempotent (no-ops if a migration was already applied),
# so running it on every boot means new migrations ship with the deploy
# itself instead of needing a manual `prisma migrate deploy` run against
# production credentials from a local machine each time.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
