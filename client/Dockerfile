FROM node:20-bookworm-slim

LABEL maintainer="PDW Monitor"
LABEL description="PDW pager decoder client - rtl_fm + multimon-ng pipeline"

# Install rtl-sdr (rtl_fm), multimon-ng (decoder), and curl (healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    rtl-sdr \
    multimon-ng \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user with USB device group access
RUN groupadd -f plugdev \
    && useradd -m -G plugdev pdwclient

WORKDIR /app

COPY pdw-client.js start-client.sh ./
RUN chmod +x start-client.sh \
    && chown -R pdwclient:pdwclient /app

ENV SERVER_URL=http://pdw-monitor:3000 \
    API_KEY= \
    RTL_FREQUENCY=157.925M \
    RTL_GAIN=40 \
    RTL_PPM=0 \
    RTL_DEVICE=0 \
    RTL_SAMPLE_RATE=22050 \
    RTL_SQUELCH=0 \
    DECODERS=POCSAG512,POCSAG1200,FLEX \
    READ_STDIN=0

USER pdwclient

CMD ["./start-client.sh"]
