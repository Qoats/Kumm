# Héberger le serveur Kumm en ligne (pour que l'application fonctionne partout, pas seulement chez vous).
# Le jeton CTS se donne en variable d'environnement CTS_TOKEN chez l'hébergeur : jamais dans l'image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Image finale : le serveur n'utilise aucune dépendance (seulement Node), donc pas de node_modules
FROM node:22-alpine
# TRUST_PROXY n'est pas activé ici : sans proxy devant, n'importe qui pourrait choisir son adresse (X-Forwarded-For).
# docker-compose.yml l'active, car Caddy est devant.
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/data ./data
# état des alertes (abonnements) : volume Docker ; clé Firebase : dossier secrets/ du serveur, monté en lecture seule
RUN mkdir -p /app/state /app/secrets && chown node:node /app/state
USER node
EXPOSE 3000
# Docker signale « unhealthy » si le serveur ne répond plus (visible avec « docker compose ps ») ; un plantage, lui, redémarre automatiquement
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
