FROM alpine:3.18

RUN apk add --no-cache postgresql15-client bash curl

COPY backup.sh /scripts/backup.sh
COPY daily-push.sh /scripts/daily-push.sh
COPY crontab /etc/crontabs/root

RUN chmod +x /scripts/*.sh

# Create backup directory
RUN mkdir -p /backups

CMD ["crond", "-f", "-l", "2"]
