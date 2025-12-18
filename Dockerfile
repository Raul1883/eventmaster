FROM node:22-alpine

RUN apk add python3 make gcc g++

WORKDIR /app

COPY package*.json ./

RUN npm install


COPY . .

EXPOSE 3000
CMD [ "node", "server.js" ]