# Company certificates

Open **Settings → Certificates**, choose a `.cer`, `.crt`, or `.pem`
file provided by IT, review its subject, issuer, expiry and SHA-256 fingerprint,
and choose **Trust certificate**. PEM bundles may contain multiple CA
certificates. Private keys, expired certificates, certificates not yet valid,
and server/leaf certificates are rejected. Ask IT for the root or intermediate
CA certificate rather than exporting a server's private key.

The Windows desktop app imports the CA into **Current User → Trusted Root
Certification Authorities**. It needs no administrator permission. The trust
also applies to other applications using this Windows account. Existing
Windows certificates remain in the Windows store if removed from AppFlowy's
imported list; only roots added by AppFlowy are removed from Windows.

Metadata and public certificate bytes are stored under the application support
directory in `company_certificates/`. Dart restores these roots before opening
network connections, and the native Rust clients use Windows' certificate
store through their native TLS backend. Certificate validation remains
mandatory. Restart AppFlowy after importing or removing a certificate to
refresh all clients and cached trust contexts.

Tests cover PEM/DER decoding, private-key rejection, read-only Windows parsing
of valid CA and invalid leaf certificates, persistence, duplicate ownership,
removal without deleting pre-existing Windows trust, and the choose/review/import
UI. Tests mock trust-store writes; they do not install test roots in Windows.
