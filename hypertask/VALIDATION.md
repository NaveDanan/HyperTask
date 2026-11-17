# Validation — 2026-11-16

Passed on a Linux Docker test host (MMEMS-mems01); no Kubernetes resources were installed.

- Helm 3.17.3 strict lint and template rendering for 10 profiles: nginx TLS, Traefik TLS, controller-default certificate, Keycloak, Keycloak under /auth, SMTP, private CA with admin disabled, optional web, existing PVCs, and internal services only.
- kubeconform 0.6.7 strict Kubernetes 1.31 API-schema validation for every rendered profile. All resources valid; none skipped.
- Rejection checks for placeholder/latest tags, external image repositories, absent/conflicting TLS settings, invalid Keycloak URLs, missing SMTP host, and unsafe database identifiers.
- Secret generation: matching S3 credentials, strong random keys, refusal to overwrite an existing file.
- Preflight fixtures with real openssl verification: accepted matching wildcard certificate; rejected wrong hostname, missing JWT key, inconsistent S3 keys and missing registry credentials. These checks simulated Kubernetes reads.
- Image-mirroring command simulations: new tag pushed once, matching tag reused without push, conflicting tag/authentication/network errors rejected without push. No registry writes were performed during validation.
- nginx configuration syntax check using the pinned proxy image; wget/nc availability confirmed for init containers.
- Isolated Docker smoke test using rendered chart environment, volumes, proxy configuration and startup waits with the pinned source images: backend health, normal signup/session, cloud account creation, modified JWT rejection, authenticated S3 PUT/GET/DELETE through nginx. Test containers, networks and volumes were removed afterward.
- Python scripts compiled; shell wrapper passed bash syntax checks.

Not yet verified against the destination cluster: actual ingress routing/TLS trust, DNS, registry pulls, storage provisioning, CNI/network policies, company SMTP and a real Keycloak login. Run scripts/preflight.py against that cluster, then the HTTPS checks in README after installation. Image publication subsequently completed under tag 0.9.51-20261116T130531Z; Artifactory checksums and pulled image content were verified for all seven components (see PUBLISHED-IMAGES.json).

This bundle prepares a fresh backend installation. It does not migrate Compose data or implement the remaining Electron Keycloak browser-login flow. The optional web image is not supplied and was only schema/render tested.

Publication follow-up: the real image values passed strict Helm lint. The mirror script also passed regression checks for Docker 29's reference-specific 404 response and OCI index/single-platform ID differences; changed runtime configurations/layers remain distinct.

Published image profiles for nginx, Traefik and Keycloak also passed strict Kubernetes 1.31 API-schema checks. The Docker export contains exactly the seven published image tags and passed gzip/tar manifest integrity checks.

Complete production values: prod-values.yaml passed strict Helm lint and Kubernetes 1.31 schema validation by itself, without image/site/provider overlays. Verified coverage of every chart-default key, exact equality with all seven published image entries, the required pull secret, and company-only Keycloak settings. Destination-specific example settings still need editing; no cluster deployment was performed.
