# RuoYi source snapshot

Upload one sanitized ZIP named `ruoyi-source.zip` into this directory using GitHub's web interface. The ZIP should contain the complete RuoYi 3.9.2 Maven project, including its root `pom.xml` and all modules declared by it. The archive may either contain the project at its root or inside one top-level folder.

The expected project contains:
- `pom.xml`
- `ruoyi-admin/pom.xml`
- All modules declared by the root POM (the current local project lists ruoyi-admin, ruoyi-framework, ruoyi-system, ruoyi-quartz, ruoyi-generator, and ruoyi-common).

Before uploading to this public repository:
- Remove real database passwords, API tokens, private keys, certificates, and production-only credentials.
- Replace local/production connection details with safe placeholders or environment-variable references.
- Do not include `target/`, logs, database dumps, uploaded business Excel files, SQLite files, or generated JARs.
- Review tracked configuration files and Git history for secrets. Removing a secret from the latest commit does not erase it from public Git history; rotate any credential that was ever exposed.

After the ZIP is uploaded, GitHub Actions extracts it in the temporary runner environment, runs `mvn -B -ntp -pl ruoyi-admin -am clean verify`, and publishes the JAR, SHA-256, and build metadata as a 14-day Actions artifact. The source archive remains in this public repository. This is a CI build artifact, not a production deployment.
