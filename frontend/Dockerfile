# Frontend image for Railway: build the Expo web bundle, then serve it as a
# static single-page app. Railway service "Root Directory" should be set to
# `frontend` so the build context is this folder.

# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /app

# The backend URL is baked into the bundle at BUILD time (Metro inlines
# EXPO_PUBLIC_* values), so it must be present before `expo export`.
# Railway passes service variables as build args when declared with ARG.
ARG EXPO_PUBLIC_BACKEND_URL
ENV EXPO_PUBLIC_BACKEND_URL=$EXPO_PUBLIC_BACKEND_URL

COPY package.json ./
# No lockfile is committed, so install fresh.
#   --production      skip devDependencies (eslint, typescript, expo-doctor).
#                     They're not needed to export the web bundle, and the
#                     package.json "resolutions" pin on @eslint/plugin-kit
#                     conflicts with the eslint packages and breaks the install.
#   --ignore-scripts  skip the repo's preinstall command guard (deploy-only build).
#   --network-timeout  survive slow/flaky registry fetches.
RUN yarn install --production --ignore-scripts --network-timeout 600000

COPY . .

# Fail the build early if the backend URL wasn't provided, instead of
# shipping a bundle that can never reach the API.
RUN test -n "$EXPO_PUBLIC_BACKEND_URL" || (echo "ERROR: set EXPO_PUBLIC_BACKEND_URL to your backend's public URL" && exit 1)
RUN yarn expo export --platform web

# ---- serve stage ----
FROM node:22-slim AS serve
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /app/dist ./dist

ENV PORT=3000
EXPOSE 3000

# -s = SPA fallback (every route serves index.html), needed for expo-router
# with web output "single".
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
