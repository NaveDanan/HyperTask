# Upstream source

This directory contains the `collab-plugins` 0.2.0 crate from
[AppFlowy-Collab](https://github.com/AppFlowy-IO/AppFlowy-Collab/tree/4dfccefb9e4fd35240107b93fb4b5966295b452e/collab-plugins),
commit `4dfccefb9e4fd35240107b93fb4b5966295b452e`.
`LICENSE` is copied unchanged from that commit's repository root.

HyperTask changes:

- `Cargo.toml` inherits HyperTask's existing workspace dependencies. Explicit `yrs`
  `sync` and `serde` `derive` features retain the upstream workspace's settings.
  `thiserror` retains the upstream workspace's version requirement directly.
  The WASM-only test dependency is pinned to `wasm-bindgen-test` 0.3.50, matching
  the existing locked `wasm-bindgen` 0.2.100 without upgrading the runtime graph.
- `kv_impl.rs` declares the child module `hyper_checkpoint`.
- `hyper_checkpoint.rs` adds a logical checkpoint using one native RocksDB snapshot.
  It copies raw keys and values through bounded synchronous write batches into a
  new database directory, propagates iterator failures and closes the result before
  returning. It leaves existing directories and symlinks untouched.

The package name and version remain unchanged. Both the crates.io patch and the
AppFlowy-Collab Git-source patch select this copy, avoiding duplicate plugin types.

The WASM-only development lock entries are aligned with the existing
`wasm-bindgen` 0.2.100: `wasm-bindgen-futures` changes from 0.4.40 to 0.4.50 and
`web-sys` from 0.3.64 to 0.3.77. The new test entries are `wasm-bindgen-test`
0.3.50, `wasm-bindgen-test-macro` 0.3.50 and `minicov` 0.3.9. These entries do
not change the native RocksDB or application runtime versions.

Run the checkpoint tests from `frontend/rust-lib` with the repository's Rust
toolchain and native RocksDB build prerequisites:

```sh
cargo test --locked -j1 -p collab-plugins --lib hyper_checkpoint -- --nocapture
cargo test --locked -j1 -p flowy-user --lib hyper_backup -- --nocapture
cargo test --locked -j1 -p lib-infra --lib hyper_backup_zip -- --nocapture
```

The first command checks a snapshot while concurrent atomic writes trigger
background compaction, byte-exact restore, failure cleanup and rejection of
existing targets. The remaining commands cover staged daily backups, observed
worker errors and atomic ZIP publication.
