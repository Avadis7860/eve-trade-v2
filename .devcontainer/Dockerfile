FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm@sha256:ef380643327dafe138722179c1ac86477a4b1f643c3a2c83d3baa1b8ea226166

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl postgresql-client \
    && npm install --global pnpm@10.15.0 \
    && rm -rf /var/lib/apt/lists/*

USER node
