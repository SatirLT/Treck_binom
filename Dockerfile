FROM node:18-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --production

COPY server/ ./server/
COPY landing/ ./landing/

EXPOSE 3000

CMD ["node", "server/src/index.js"]
