import 'package:appflowy/env/backend_env.dart';
import 'package:appflowy/env/cloud_env.dart';
import 'package:appflowy/startup/entry_point.dart';
import 'package:appflowy/startup/launch_configuration.dart';
import 'package:appflowy/startup/startup.dart';
import 'package:appflowy/user/presentation/screens/splash_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _ReachedDependencies implements Exception {
  const _ReachedDependencies();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });
  tearDown(() async {
    await getIt.reset();
    IntegrationTestHelper.didInitGetItCallback = null;
    IntegrationTestHelper.rustEnvsBuilder = null;
    FlowyRunner.currentMode = IntegrationMode.develop;
  });
  test('first launch reaches dependency initialization with empty GetIt',
      () async {
    expect(getIt.isRegistered<AppFlowyCloudSharedEnv>(), false);
    await expectLater(
      FlowyRunner.run(
        AppFlowyApplication(),
        IntegrationMode.unitTest,
        didInitGetItCallback: () async {
          throw const _ReachedDependencies();
        },
      ),
      throwsA(isA<_ReachedDependencies>()),
    );
  });
  test('local entry point selects anonymous splash after dependencies exist',
      () {
    getIt.registerSingleton<AppFlowyCloudSharedEnv>(
      AppFlowyCloudSharedEnv(
        authenticatorType: AuthenticatorType.local,
        appflowyCloudConfig: AppFlowyCloudConfiguration.defaultConfig(),
      ),
    );
    final splash = AppFlowyApplication().create(
      const LaunchConfiguration(version: '1.0.0', rustEnvs: {}),
    ) as SplashScreen;
    expect(splash.isAnon, true);
  });
}
