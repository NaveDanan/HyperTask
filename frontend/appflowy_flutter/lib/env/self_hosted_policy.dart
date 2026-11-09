import 'dart:io';

/// Vendor-hosted services are never used by this self-hosted distribution.
class SelfHostedPolicy {
  const SelfHostedPolicy._();

  static bool isVendorHost(String host) {
    final normalized = host.toLowerCase().replaceFirst(RegExp(r'\.$'), '');
    return const ['appflowy.com', 'appflowy.io', 'appflowy.cloud'].any(
      (domain) => normalized == domain || normalized.endsWith('.$domain'),
    );
  }

  static void validateServerUrl(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null ||
        !['http', 'https'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        (uri.path.isNotEmpty && uri.path != '/')) {
      throw const FormatException(
        'Enter your server origin, such as https://appflowy.internal, without a path or credentials.',
      );
    }
    if (isVendorHost(uri.host)) {
      throw const FormatException(
        'AppFlowy hosted services are disabled. Enter your own server address.',
      );
    }
  }

  static void installNetworkPolicy() {
    HttpOverrides.global = _SelfHostedHttpOverrides();
  }
}

class _SelfHostedHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final client = super.createHttpClient(context);
    // Called for redirects too, before DNS/proxy connection or credentials.
    client.connectionFactory = (uri, proxyHost, proxyPort) {
      if (SelfHostedPolicy.isVendorHost(uri.host)) {
        return Future<ConnectionTask<Socket>>.error(
          const HttpException(
            'AppFlowy hosted services are disabled in this self-hosted app.',
          ),
        );
      }
      // A custom connectionFactory replaces the SDK's TLS setup for direct
      // HTTPS. Proxy sockets stay plain: the SDK performs CONNECT and then
      // upgrades that tunnel to TLS itself. Never bypass certificate checks.
      if (uri.scheme == 'https' && proxyHost == null) {
        return SecureSocket.startConnect(uri.host, uri.port, context: context);
      }
      return Socket.startConnect(proxyHost ?? uri.host, proxyPort ?? uri.port);
    };
    return client;
  }
}
