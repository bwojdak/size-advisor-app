# --- build stage: pełne zależności, kompilacja ---
FROM node:20-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# --- runtime stage: tylko zależności produkcyjne + zbudowana apka ---
FROM node:20-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

EXPOSE 3000

# docker-start = `prisma generate && prisma migrate deploy` (setup) + `react-router-serve` (start)
CMD ["npm", "run", "docker-start"]
