FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
RUN npm ci
COPY web ./web
RUN npm run build --workspace @brightloop/web

EXPOSE 4173
CMD ["npm", "run", "preview", "--workspace", "@brightloop/web", "--", "--host", "0.0.0.0", "--port", "4173"]
