FROM postgres:16-alpine

COPY docker-entrypoint.sh /usr/local/bin/brain-core-postgres-entrypoint
RUN chmod 755 /usr/local/bin/brain-core-postgres-entrypoint

ENTRYPOINT ["/usr/local/bin/brain-core-postgres-entrypoint"]
CMD ["postgres"]
