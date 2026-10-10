# syntax=docker/dockerfile:1.7

FROM mysql:8.4 AS mysql-client

FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS studio-build

WORKDIR /opt/yuncms

COPY package.json package-lock.json ./
COPY apps/studio/package.json apps/studio/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/extensions-sdk/package.json packages/extensions-sdk/package.json

RUN npm ci

COPY apps/studio apps/studio
COPY packages packages

RUN npm run build:studio

FROM node:24-bookworm-slim AS build

WORKDIR /opt/yuncms

COPY package.json package-lock.json ./
COPY apps/studio/package.json apps/studio/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/extensions-sdk/package.json packages/extensions-sdk/package.json

RUN npm ci --omit=dev

COPY packages packages
COPY --from=studio-build /opt/yuncms/packages/api/studio-dist /opt/yuncms/packages/api/studio-dist

FROM node:24-bookworm-slim AS runtime

ARG BUILD_DATE
ARG VERSION=dev
ARG VCS_REF=unknown

LABEL org.opencontainers.image.title="YunCMS" \
  org.opencontainers.image.description="A programmable MySQL CMS/backend with a focused React Studio." \
  org.opencontainers.image.url="https://yunsoft.com" \
  org.opencontainers.image.source="https://github.com/Yunsoft-Software/yuncms" \
  org.opencontainers.image.documentation="https://github.com/Yunsoft-Software/yuncms/blob/main/docs/docker.md" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.created="${BUILD_DATE}" \
  org.opencontainers.image.version="${VERSION}" \
  org.opencontainers.image.revision="${VCS_REF}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libncurses6 \
    libssl3 \
    libstdc++6 \
    libtinfo6 \
    tini \
    zlib1g \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/uploads /data/extensions \
  && chown -R node:node /data

COPY --from=mysql-client /usr/bin/mysql /usr/bin/mysql
COPY --from=mysql-client /usr/bin/mysqldump /usr/bin/mysqldump
COPY --from=mysql-client /usr/share/doc/mysql-community-server-minimal/LICENSE /usr/share/doc/yuncms-mysql-client/LICENSE

RUN ldd /usr/bin/mysql \
  && ldd /usr/bin/mysqldump \
  && mysql --version \
  && mysqldump --version \
  && mysql --version | grep -qi "mysql" \
  && ! mysql --version | grep -qi "mariadb" \
  && mysqldump --version | grep -qi "mysql" \
  && ! mysqldump --version | grep -qi "mariadb"

WORKDIR /data

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3008 \
  FILES_LOCAL_ROOT=/data/uploads

COPY --from=build --chown=node:node /opt/yuncms/package.json /opt/yuncms/package-lock.json /opt/yuncms/
COPY --from=build --chown=node:node /opt/yuncms/node_modules /opt/yuncms/node_modules
COPY --from=build --chown=node:node /opt/yuncms/packages /opt/yuncms/packages
COPY --chown=node:node LICENSE /opt/yuncms/LICENSE

USER node

VOLUME ["/data"]
EXPOSE 3008

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3008') + '/ready').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

ENTRYPOINT ["tini", "--", "node", "/opt/yuncms/packages/cli/bin/yuncms.js"]
CMD ["start"]
