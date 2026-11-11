# HyperCloud workspace role policy patch

This candidate fixes stale workspace authorization in the public AppFlowy Cloud 0.9.51 source. It has passed 17 ACL unit tests, one real PostgreSQL cancellation test and a production binary build. A fresh-member native test passes authorized editing, Guest downgrade denial and full revocation denial, each checked by a cold owner client. The seven-stage document/database/file baseline also passes. See [runtime evidence](HyperCloud-0.9.51-workspace-role-policy.runtime.json). The default deployment image and existing source override are unchanged; this directory does not automatically apply or deploy the patch.

## Source and license

Apply [the patch](0001-HyperCloud-0.9.51-workspace-role-policy.patch) only to AppFlowy Cloud commit `0311f6a9314da56e12d2b33d18c398dba1933240`, the source revision published with the 0.9.51 image. The upstream repository is <https://github.com/AppFlowy-IO/AppFlowy-Cloud>.

The source remains AGPL-3.0. Preserve its `LICENSE`, copyright notices and source availability requirements when distributing or operating a modified server. The patch leaves the upstream license, Cargo manifests, Cargo lockfile, protocol definitions and SQL schema unchanged. The existing `compose.source.yaml` uses a different source commit, `592f644a24beb159d45f25a4cabc34621ef7382c`; it is not this candidate's build recipe.

[Provenance](HyperCloud-0.9.51-workspace-role-policy.provenance.json) records the exact base, patch checksum, license and lockfile checksums, validation counts, compiler and observed binary checksum. The binary checksum identifies one tested local build, not an OCI image or an independently reproduced binary.

## Behavior

The upstream policy update adds a new role while retaining an old role for the same user and workspace. This patch replaces that policy under the enforcer write guard. An uncertain or failed update remains denied, including adapter errors, rejected updates and cancellation. A direct trusted-role callback cannot reopen a denied workspace key; recovery requires a successful committed-role refresh or an authoritative reload.

Existing-membership changes acquire leases for the affected immutable user IDs and workspaces in sorted order. Denial starts before database work is polled. Database transactions also acquire deterministic, namespaced PostgreSQL transaction advisory locks. These preserve ordering while a canceled SQL future's statement or commit is still draining. The global enforcer write guard is released during database work.

After commit, one database snapshot reads the actual optional roles in the original target order. Token checks prevent an older callback or dropped future from clearing newer authorization state. Policy replacement then completes under the enforcer write guard. The patch covers role updates, atomic batch removal, invitation acceptance, join by code and access-request approval. New Owner bootstrap grants occur after their initial commit. A join that encounters an existing Guest row cannot manufacture an in-memory Member grant from `ON CONFLICT DO NOTHING`.

The leases and denial state are process-local. PostgreSQL advisory locks order database writes, but this patch does not distribute policy invalidations between Cloud replicas. High-availability revocation has not been validated.

## Apply and validate

Use a new checkout, verify the full source commit and check the patch before applying it:

```sh
git checkout --detach 0311f6a9314da56e12d2b33d18c398dba1933240
git apply --check /path/to/0001-HyperCloud-0.9.51-workspace-role-policy.patch
git apply /path/to/0001-HyperCloud-0.9.51-workspace-role-policy.patch
```

A fresh checkout application was verified, and all 15 patched files matched the validated source byte for byte. Upstream's build script regenerates two tracked Rust protobuf files; its whitespace-only formatting changes were excluded from this patch. No protobuf definitions or wire fields changed.

The validated Linux/amd64 build used Rust 1.85.0, a C compiler, OpenSSL 3 development headers/libraries and protobuf compiler. SQLx compilation used checked-in offline metadata. Use a separate build target and one compiler job on a constrained machine:

```sh
export CARGO_TARGET_DIR="$PWD/target-hyper-cloud"
export CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=1
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
export SQLX_OFFLINE=true
cargo +1.85.0 test --locked -j1 -p access-control --lib
cargo +1.85.0 build --locked -j1 -p appflowy-cloud --bin appflowy_cloud
```

Configure `PROTOC` and the OpenSSL include/library directories if those prerequisites are provided privately. The observed ordinary binary passed host loader verification and dependency resolution. No Docker image was built or published, and independent byte-for-byte reproduction remains unverified.

The separate PostgreSQL test requires an operator-created, **new empty loopback database** named `hyper_role_policy_test_<UUID>`. It refuses other names, non-loopback hosts and existing relations. Supply `HYPER_ROLE_TEST_DATABASE_URL` through a private child environment, never a command argument or committed file, then run:

```sh
cargo +1.85.0 test --locked -j1 -p access-control --test hyper_role_transactions
```

The role needs object creation in that disposable database, transaction advisory locks and visibility of its own backend activity. The test delays an older Member write inside PostgreSQL's commit, aborts its Rust future, starts a newer Guest update and verifies that Guest remains the final committed role. It also checks other-user/workspace isolation. It never uses the deployment's existing `appflowy` database.

The observed binary passed clean owned membership setup, an authorized Member edit and cold-owner read, Guest downgrade and full revocation checks on the existing client, and the document/database/file baseline. Fresh Guest workspace navigation remains a separate client gap. Container/proxy/TLS validation and multi-replica revocation remain open before treating this as a complete deployment or permission matrix. A local RPC acknowledgment alone does not establish remote persistence or denial. Preserve existing data and the unmodified server artifact for comparison. No remove/reinvite workaround is part of this patch.


## Optional source-pinned Cloud build

`compose.hyper-cloud-roles.yaml` provides a separate Linux/amd64 build of this exact public AGPL source and patch. It overrides only `appflowy_cloud`; the default images, other services and older `compose.source.yaml` are unchanged. Do not combine the two source overrides.

From `deploy/self-hosted`, prepare and verify the isolated context before building:

```sh
python3 -B patches/HyperPrepareCloudRoles.py
python3 -B patches/HyperPrepareCloudRoles.py --verify-only .sources/hyper-cloud-role-policy
docker compose -f compose.yaml -f compose.hyper-cloud-roles.yaml build appflowy_cloud
```

The preparer needs Python 3, Git and Linux atomic no-replace rename support. It fetches the full pinned commit into a new staging directory, verifies the patch, license, Cargo lockfile and canonical patched source tree, then publishes `.sources/hyper-cloud-role-policy`. Re-running it only verifies existing prepared files. It never checks out, resets or cleans an existing destination, including an empty or user-edited directory. Concurrently created destinations are preserved. An edited or outdated context fails verification; choose a new destination and adjust a private override copy if existing work must be retained.

The prepared context contains the patch, source identity, license, provenance, runtime evidence and copied build recipe. Project-side verification compares copied metadata with the trusted current bundle, so editing metadata and its marker checksums does not silently adopt it. The recipe verifies its checker checksum and canonical source before running Cargo. Its Dockerfile-specific ignore file retains all required source inputs while excluding Git metadata and build output, following [Docker's ignore-file precedence](https://docs.docker.com/build/concepts/context/#filename-and-location).

The override sets `pull_policy: never`. Build the local image explicitly; it must not fall back to a registry image with the same custom tag. Compose documents this policy as using the local cached image and failing when none exists. [Compose pull policy](https://docs.docker.com/reference/compose-file/services/#pull_policy). Use the same two Compose files for later Cloud operations; do not substitute a default `pull` workflow for this source build.

The Rust 1.85.0 Bookworm builder and Debian 12.10 slim runtime are pinned by verified OCI index digests. [Base-image metadata](HyperCloud-role-build.images.json) also records their Linux/amd64 manifests. Only registry metadata was fetched during recipe preparation. The runtime retains `curl` for the inherited Cloud health check, and includes OpenSSL 3 and CA certificates. The image preserves the upstream license and source/build provenance under `/usr/share/doc/hyper-cloud-role-policy`.

The ordinary-process binary and native client proofs do **not** validate this container build, reverse proxy, TLS deployment or release-profile resource requirements. No Docker image has been built or published here. Independent byte-for-byte reproducibility remains unverified; APT repository contents are not snapshot-pinned. Keep the prepared corresponding source and license/provenance available when distributing or operating the modified server.
