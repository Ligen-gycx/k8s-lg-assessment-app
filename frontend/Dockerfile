FROM docker.m.daocloud.io/library/node:22-alpine AS build
WORKDIR /workspace
COPY package.json .
RUN npm install
COPY . .
RUN npm run build

FROM docker.m.daocloud.io/nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist /usr/share/nginx/html
EXPOSE 8080
