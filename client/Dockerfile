FROM node:20-bookworm-slim

LABEL maintainer="PDW Monitor"
LABEL description="PDW client - RTL-SDR pager decoder"

# Install rtl-sdr, multimon-ng, tini (init system), curl (healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    rtl-sdr \
    multimon-ng \
    tini \
    curl \
    udev \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /etc/udev/rules.d

# Create app directory first, then non-root user
RUN mkdir -p /app && \
    groupadd -f -r pdw && \
    useradd -r -g pdw -G plugdev,audio -d /app -s /usr/sbin/nologin pdw && \
    chown -R pdw:pdw /app

WORKDIR /app

# Copy application code
COPY pdw-client.js ./
COPY start-client.sh ./
RUN chmod +x start-client.sh

# Default env vars - tuned for city suburb / modern townhouse (moderate RF noise)
ENV SERVER_URL=http://localhost:3000 \
    RTL_FREQUENCY=157.950M \
    RTL_GAIN=32 \
    RTL_PPM=0 \
    RTL_DEVICE=0 \
    RTL_SAMPLE_RATE=22050 \
    RTL_SQUELCH=0 \
    DECODERS=POCSAG512,POCSAG1200,FLEX \
    BATCH_SIZE=10 \
    BATCH_INTERVAL_MS=2000 \
    DEDUP_WINDOW_S=30 \
    MULTIPART_TIMEOUT_MS=10000 \
    EXCLUDE_CAPCODES= \
    MAX_RETRIES=5 \
    RETRY_BASE_MS=2000 \
    MAX_QUEUE_SIZE=1000 \
    PIPELINE_RESTART_DELAY_MS=5000 \
    PDW_HEALTH_FILE=/tmp/.pdw-last-message \
    DEBUG=0

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=3 \
  CMD pgrep -f "rtl_fm" > /dev/null && pgrep -f "multimon-ng" > /dev/null && pgrep -f "pdw-client" > /dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]

USER pdw

CMD ["./start-client.sh"]
