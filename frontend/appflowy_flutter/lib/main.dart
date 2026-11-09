import 'package:appflowy/features/company_certificates/company_certificate_store.dart';
import 'package:scaled_app/scaled_app.dart';
import 'package:appflowy/env/self_hosted_policy.dart';

import 'startup/startup.dart';

Future<void> main() async {
  SelfHostedPolicy.installNetworkPolicy();
  ScaledWidgetsFlutterBinding.ensureInitialized(
    scaleFactor: (_) => 1.0,
  );

  try {
    await CompanyCertificateStore().restoreTrust();
  } catch (_) {
    // A damaged imported certificate must not prevent the workspace opening.
  }
  await runAppFlowy();
}
