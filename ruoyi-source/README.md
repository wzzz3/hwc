# RuoYi source snapshot

Place the sanitized, complete RuoYi 3.9.2 Maven source tree in this directory.

Required layout:
- `ruoyi-source/pom.xml`
- `ruoyi-source/ruoyi-admin/pom.xml`
- Every module declared by the root `pom.xml` (the current local project lists ruoyi-admin, ruoyi-framework, ruoyi-system, ruoyi-quartz, ruoyi-generator, and ruoyi-common).

Before uploading to this public repository:
- Remove real database passwords, API tokens, private keys, certificates, and production-only credentials.
- Replace local/production connection details with safe placeholders or environment-variable references.
- Do not include `target/`, logs, database dumps, uploaded business Excel files, SQLite files, or generated JARs.
- Review tracked configuration files and Git history for secrets. Removing a secret from the latest commit does not erase it from public Git history; rotate any credential that was ever exposed.

The GitHub Actions workflow builds only after the complete Maven source snapshot exists. It runs `mvn -B -ntp -pl ruoyi-admin -am clean verify`, then publishes the JAR, SHA-256, and build metadata as a workflow artifact. This is a CI build artifact, not a production deployment.
