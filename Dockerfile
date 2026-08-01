# Web (Next.js) 容器。docker-compose 中配合 Postgres 使用。
FROM node:20-bookworm-slim

WORKDIR /app

# 系统依赖（prisma 需要 openssl）
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# 使用 Postgres schema（见 prisma/schema.postgres.prisma），生成客户端
RUN cp prisma/schema.postgres.prisma prisma/schema.prisma || true
RUN npx prisma generate

EXPOSE 3000

# 启动：等待 DB → 迁移 → 种子 → 开发服务
CMD ["sh", "-c", "npx prisma db push && npx tsx prisma/seed.ts && npm run dev"]
