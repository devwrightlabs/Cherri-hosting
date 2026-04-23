FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package*.json ./
RUN npm ci

# Build the static assets
FROM deps AS builder
# Accept Vite env variables as build args so they are baked into the bundle
ARG VITE_API_URL=http://localhost:4000
ARG VITE_PI_SANDBOX=true
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PI_SANDBOX=$VITE_PI_SANDBOX
COPY . .
RUN npm run build

# Serve with a lightweight static server
FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
