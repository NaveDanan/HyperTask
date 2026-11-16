# HyperTask on Kubernetes / K3s

This folder installs the **backend** behind your cluster's existing HTTPS ingress. Electron stays on employee computers. The chart includes PostgreSQL/pgvector, Redis, SeaweedFS (S3), GoTrue, AppFlowy Cloud, nginx and an optional admin console. No external Helm dependencies or certificate downloads run at installation time.

Use a hostname already covered by your wildcard certificate, for example **hypertask.apps.company.internal** for **\*.apps.company.internal**. Add internal DNS pointing that name at the ingress address. Users connect on **443**. You do not need a new certificate if the existing certificate covers that name and employee computers trust its CA.

This is a fresh, single-replica data deployment, not an HA database setup. It does not copy data from the existing Docker Compose environment. Do not mount old Compose volumes directly without a planned migration.

## 1. Prepare the images on a connected Linux builder

Required tools: Docker, Python 3.8+, JFrog CLI configured for Artifactory, Helm 3.17+, kubectl, openssl. Run commands below from this folder. The offline cluster needs access to its internal registry, DNS, storage and identity provider only.

For MMEMS, every workload and init-container image must be mirrored under `artifactory.rafael.co.il/mems-docker-local-ww/danan/` and use `nave-pull-secret`. Never import images into nodes by hand. Keep each published tag immutable.

```bash
jf rt ping
bash scripts/mirror-images.sh --tag 0.9.51-20261116.1
```

Choose a new unique tag for each image release. The script pulls digest-pinned images from `images.lock.json`, checks existing tags, pushes missing images, verifies them and creates `.private/values.images.json`. It reuses an existing tag only when its image matches; it never replaces different content. Registry errors stop the script.

Copy the entire folder **and that generated image-values file** to the offline administration machine. Ensure its registry has the mirrored images before disconnecting. For a different internal registry use `--prefix registry.company.internal/team/`; MMEMS must keep its mandated Artifactory prefix. Images are currently pinned for **linux/amd64**. Bring the CLI binaries into the offline environment ahead of time.

## 2. Set hostname, storage and existing certificate

```bash
cp values.tls.example.yaml values.site.yaml
# Edit values.site.yaml: global.host, global.storageClassName,
# ingress.className, ingress.tls.secretName, controller namespace.
kubectl create namespace hypertask
```

For Traefik, copy `values.traefik.example.yaml` instead. Use a StorageClass installed in your cluster (for example Longhorn or local-path). Default requested capacity: PostgreSQL 20Gi, Redis 2Gi, files 50Gi. Local-path storage ties data to one node; use replicated storage and backups where required.

TLS certificates and pull secrets are namespaced. If the wildcard secret is elsewhere, copy it without displaying credentials:

```bash
python3 scripts/copy-secret.py nave-pull-secret --from-namespace newsletter
python3 scripts/copy-secret.py wildcard-apps-tls --from-namespace ingress-nginx
```

Change source namespace and certificate name to your actual cluster. Skip each copy when the correct Secret already exists in `hypertask`. A copied TLS secret does **not** follow renewal automatically: configure secret replication, renew the copy when needed, or use the ingress controller's default wildcard certificate.

If the controller already serves the correct wildcard as its default, add `-f values.controller-default-tls.example.yaml` to **every** Helm/preflight command instead of copying the TLS secret. The chart does not issue certificates or install cert-manager/ingress controllers.

## 3. Create application credentials once

```bash
python3 scripts/generate-secrets.py
kubectl create -f .private/hypertask-secret.json
```

For Keycloak, use `python3 scripts/generate-secrets.py --keycloak` **instead** on first setup; it prompts privately for the client secret. Add `--smtp` if you need SMTP credentials. Secret values never belong in Helm values or Git. Back up the private JSON securely and retain these credentials across upgrades. The generator refuses to overwrite an existing file. Do not regenerate the database password or JWT key when upgrading.

The default profile permits email/password signup and auto-confirms it without SMTP for initial testing. It does not send login emails. For company identity use the Keycloak profile below. Without SMTP, password resets and email invitations will not work.

## 4. Optional: configure company Keycloak

Use the existing internal Keycloak; it can federate users from AD. The backend does not need a second Keycloak installation.

Create an **OpenID Connect** client with:

| Setting | Value |
| --- | --- |
| Client ID | hypertask-gotrue |
| Client authentication | On (confidential client) |
| Standard flow | On |
| Authorization | Off |
| Root URL | https://hypertask.apps.company.internal |
| Valid redirect URI | https://hypertask.apps.company.internal/gotrue/callback |
| Web origin, if required | https://hypertask.apps.company.internal |

Use the exact hostname from `values.site.yaml`. Copy the client's secret into the application Secret using the private prompt above. Set `keycloak.issuerUrl` and `keycloak.clientId` in a copy of `values.keycloak.example.yaml`, then add `-f values.keycloak.site.yaml` to the preflight/install/upgrade commands.

The Keycloak profile disables email authentication and allows accounts to be created on first successful provider login. Keycloak must return a user subject and email; configure the profile/email scopes and company account access there. GoTrue performs the provider exchange and issues its own signed session JWT for the backend. **This does not accept arbitrary JWTs.**

If Keycloak uses a private CA, create a ConfigMap with a PEM CA bundle (include all trust roots needed by these services):

```bash
kubectl -n hypertask create configmap hypertask-company-ca --from-file=ca-bundle.crt=/secure/company-ca-bundle.pem
# Set global.trustedCa.existingConfigMap: hypertask-company-ca in values.site.yaml.
```

**Desktop limitation:** the current Electron sign-in still needs its Keycloak browser-login integration. Configuring the backend provider alone does not add automatic company SSO to Electron. Employee Windows machines must also trust your company certificate authority. AD FS alone is not configured by this Keycloak profile.

## 5. Check and install

Select the intended kubeconfig/context first. The preflight reads the target cluster and does not apply resources.

```bash
helm lint chart --strict -f values.site.yaml -f .private/values.images.json
python3 scripts/preflight.py -f values.site.yaml -f .private/values.images.json
helm upgrade --install hypertask ./chart --namespace hypertask \
  -f values.site.yaml -f .private/values.images.json \
  --wait --timeout 15m
```

Add your Keycloak and/or default-certificate values files to all three commands when using them. For another registry, also pass its prefix to preflight with `--registry-prefix`.

```bash
kubectl -n hypertask get pods,svc,ingress,pvc
curl --fail https://hypertask.apps.company.internal/healthz
curl --fail https://hypertask.apps.company.internal/gotrue/health
curl --fail https://hypertask.apps.company.internal/health
```

Use normal certificate verification; install your company CA on the administration machine when required. Configure Electron's **Storage & server** URL to `https://hypertask.apps.company.internal`. WebSockets use `wss://hypertask.apps.company.internal/ws`. No NodePort or port forwarding is required.

## Operation

- Save the exact values, image digests, application credentials and database/file backups for each release. Back up PostgreSQL and the SeaweedFS PVC consistently; test restores. Redis uses AOF persistence.
- PVCs are retained by Helm uninstall and ArgoCD pruning. Uninstalling does not remove data. Reinstalling into retained claims requires deliberate PVC adoption or the `postgres.existingClaim`, `redis.existingClaim`, `storage.existingClaim` settings. Never delete PVCs to fix a rollout.
- Upgrades: mirror a new immutable tag, retain application Secret/PVCs, then use the same Helm command. Changing Secret or CA ConfigMap contents requires a controlled restart of the affected workloads; do not casually rotate database/JWT/S3 keys.
- NetworkPolicy permits communication within this release and ingress to nginx from the configured controller namespace. Egress stays open for internal DNS, Keycloak, SMTP and registry-related infrastructure; internet isolation belongs to the on-prem network. Check CNI support and controller networking if ingress is blocked.
- AI/indexing and public identity providers are disabled. The optional web frontend is off and has no prebuilt image in this bundle. To enable it, supply a same-origin `/app`-compatible image, add its pinned source as `web` in the image lock, mirror it, then set `web.enabled=true`.
- Admin console is at `/console` and may be disabled with `admin.enabled=false`. Restrict access according to your company's policy. The chart does not create an administrator user or SMTP server.
- Optional ArgoCD: adapt `argocd/application.example.yaml` to the repository/path holding this folder and your non-secret image/site values. Sync manually after committing the configuration. Secrets remain external to Git.

For rendering checks without publishing images: `python3 tests/validate.py` (Helm and PyYAML required). Render-test image tags are for tests only and must never be deployed. See `VALIDATION.md` for what was actually checked.
