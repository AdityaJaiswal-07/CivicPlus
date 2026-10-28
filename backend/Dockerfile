# Build stage: compile TypeScript
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies + compiled code only, non-root
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
