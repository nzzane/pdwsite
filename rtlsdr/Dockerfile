FROM node:20-bookworm-slim

LABEL maintainer="PDW Monitor"
LABEL description="RTL-SDR FireComm audio streaming server"

# Install rtl-sdr and ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    rtl-sdr \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (but needs access to USB via plugdev group)
RUN groupadd -f plugdev \
    && useradd -m -G plugdev,audio rtlsdr

WORKDIR /app
COPY stream.js ./

RUN chown -R rtlsdr:rtlsdr /app

ENV FREQ=75.5875M \
    MODE=fm \
    GAIN=40 \
    SQUELCH=0 \
    SAMPLE_RATE=200000 \
    STREAM_PORT=8090

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -sf http://localhost:8090/status || exit 1

USER rtlsdr

CMD ["node", "stream.js"]
