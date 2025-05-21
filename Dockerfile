FROM node:18-slim

# Puppeteer 실행에 필요한 시스템 의존성 설치
RUN apt-get update && apt-get install -y \
    libxcomposite1 libxrandr2 libxi6 libxkbcommon0 \
    libgbm1 libasound2 \
    fonts-noto-color-emoji \
    locales \
    gconf-service \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libfontconfig1 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libglib2.0-dev \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxrender1 \
    libxslt1.1 \
    libxtst6 \
    libappindicator1 \
    libnss3-dev \
    libgconf-2-4 \
    libgtk-3-0 \
    libnotify4 \
    libvulkan1 \
    libxtst6 \
    libgbm-dev \
    xvfb \
    # 필요한 경우 libu2f-udev 추가 (일부 환경에서)
    # libu2f-udev \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

RUN locale-gen ko_KR.UTF-8
ENV LANG ko_KR.UTF-8
ENV LC_ALL ko_KR.UTF-8

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# 여기를 본인 스크립트 파일명으로 변경
CMD ["node", "monitor.js"]