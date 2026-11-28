# Neko Chromium for a network that reaches the web only through an HTTPS-inspecting proxy
# (the development container). Chromium keeps certificate checking ON: the environment's CA
# bundle is added to its own NSS trust store (built on the host by ./build.sh, copied in),
# and Chromium is routed through the proxy. For a normal server use ../docker-compose.yml.
FROM ghcr.io/m1k1o/neko/chromium:latest
ARG PROXY=http://127.0.0.1:37683
USER root
COPY --chown=1000:1000 nssdb /home/neko/.pki/nssdb
RUN sed -i "s#  --disable-dev-shm-usage#  --disable-dev-shm-usage\n  --proxy-server=${PROXY}\n  --proxy-bypass-list=<-loopback>\n  --hide-crash-restore-bubble\n  --remote-debugging-address=127.0.0.1\n  --remote-debugging-port=9222\n  --remote-allow-origins=http://127.0.0.1:9222#" /etc/neko/supervisord/chromium.conf && grep -n "proxy" /etc/neko/supervisord/chromium.conf
