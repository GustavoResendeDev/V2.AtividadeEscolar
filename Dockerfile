# Imagem de produção do sistema Nova Era Barbearia.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY scripts ./scripts
COPY public ./public
# O banco fica num volume para sobreviver a atualizações da imagem.
ENV DB_PATH=/dados/novaera.db BACKUP_DIR=/dados/backups
VOLUME /dados
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
