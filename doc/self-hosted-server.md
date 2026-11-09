# Self-hosting HyperTask

HyperTask uses an AppFlowy-compatible collaboration server. The example deployment in [deploy/self-hosted](../deploy/self-hosted/) provides Cloud, GoTrue, PostgreSQL, Redis, SeaweedFS and an NGINX proxy. It uses pinned upstream images compatible with the client API in this checkout.

## Start

Copy the deployment directory to your server, install Docker Compose and Python 3, then run:

```sh
cd appflowy-self-host
./bootstrap.sh http://collaboration.example.com:8080
./manage.sh health
python3 verify-storage.py
```

Replace the example address with your server's address. Configure the same origin under **Settings → Storage & server** in the desktop app. Local workspaces and server workspaces are separate; use export and import to move data between them.

The bootstrap generates local secrets and preserves existing volumes. Keep the generated `.env`, `.s3.json`, certificates, session files and backups private. Only the proxy publishes a port; the other services use an internal Docker network.

Password signup works without SMTP. Email login links, password recovery and invitations require a separately configured mail service. Server-side AI is disabled by default; configure a separate AI endpoint in the desktop client.

## Backups and TLS

`./manage.sh backup` saves the database, object storage and configuration. Store backups securely and test restores in a separate deployment. For HTTPS, supply a trusted certificate and use the included `enable-tls.sh` and `compose.tls.yaml`.
