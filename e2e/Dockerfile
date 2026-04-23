ARG PLAYWRIGHT_VERSION=v1.58.2
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION}-noble

# Never open or serve report inside container; host opens static report after run
ENV PLAYWRIGHT_HTML_OPEN=never

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

ENTRYPOINT ["npx", "playwright", "test"]
