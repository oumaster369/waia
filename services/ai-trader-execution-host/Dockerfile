FROM node:22-alpine

RUN addgroup -S waia && adduser -S waia -G waia

WORKDIR /app

COPY server.mjs ./

USER waia

EXPOSE 8080

ENV EXECUTION_HOST_PORT=8080

CMD ["node", "server.mjs"]
