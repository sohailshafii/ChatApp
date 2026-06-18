# Self-run Valkey for the multi-machine scale-out (docs/multi-machine.md, phase 6).
# A thin wrapper over the official image that runs our start script (so the
# password comes from a Fly secret, not the image).
FROM valkey/valkey:8-alpine

COPY start-valkey.sh /usr/local/bin/start-valkey.sh
RUN chmod +x /usr/local/bin/start-valkey.sh

EXPOSE 6379
ENTRYPOINT ["/usr/local/bin/start-valkey.sh"]
