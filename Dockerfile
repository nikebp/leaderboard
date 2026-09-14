FROM node:20-alpine

WORKDIR /app
COPY server.js /app/server.js

ENV DATA_DIR=/data
VOLUME /data

EXPOSE 8080

CMD ["node", "server.js"]
