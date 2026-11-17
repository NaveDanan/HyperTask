# Published backend images

Release: **0.9.51-20261116T130531Z**

All seven linux/amd64 images have been pushed to Artifactory, pulled back, and verified against the pinned source runtime configuration/layers. Each stored manifest SHA-256 also matches Artifactory's artifact checksum. Existing published tags were not overwritten.

| Component | Image |
| --- | --- |
| postgres | `artifactory.rafael.co.il/mems-docker-local-ww/danan/hypertask-postgres:0.9.51-20261116T130531Z` |
| redis | `artifactory.rafael.co.il/mems-docker-local-ww/danan/hypertask-redis:0.9.51-20261116T130531Z` |
| storage | `artifactory.rafael.co.il/mems-docker-local-ww/danan/hypertask-storage:0.9.51-20261116T130531Z` |
| gotrue | `artifactory.rafael.co.il/mems-docker-local-ww/danan/hypertask-gotrue:0.9.51-20261116T130531Z` |
| cloud | `artifactory.rafael.co.il/mems-docker-local-ww/danan/hypertask-cloud:0.9.51-20261116T130531Z` |
| admin | `artifactory.rafael.co.il/mems-docker-local-ww/danan/hypertask-admin:0.9.51-20261116T130531Z` |
| proxy | `artifactory.rafael.co.il/mems-docker-local-ww/danan/hypertask-proxy:0.9.51-20261116T130531Z` |

Use the complete `prod-values.yaml` (it already includes these image digests) with Helm:

```bash
helm upgrade --install hypertask ./chart --namespace hypertask \
  -f prod-values.yaml --wait --timeout 15m
```

Set the site hostname, existing TLS secret, storage class and Keycloak realm/client first. Create the application Secret and namespace pull secret as described in README. Every workload uses `nave-pull-secret`; a new target namespace needs its own copy.

Full registry/source digests and verification time are recorded in `PUBLISHED-IMAGES.json`. These values contain no registry credentials. This publication did not install Kubernetes resources.
