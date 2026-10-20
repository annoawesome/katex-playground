FROM node:24-alpine AS builder

WORKDIR /app/
COPY package*.json tsconfig.json /app/
RUN npm ci
COPY ./ /app/
RUN npm run build

FROM nginx:stable-alpine3.24-perl

COPY --from=builder /app/dist/ /usr/share/nginx/html/

EXPOSE 80
