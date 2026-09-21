import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/config_problem_screen.dart';
import 'package:ecom/Services/app_config.dart';
import 'package:ecom/main.dart';

AppConfig config({String api = '', bool release = false}) => AppConfig(
      defineApiBaseUrl: api,
      defineMapTilesUrl: '',
      dotenvLookup: (_) => null,
      isRelease: release,
    );

void main() {
  group('buildRootWidget (the release gate in main)', () {
    test('release with a missing API address shows the config problem screen', () {
      final root = buildRootWidget(config(release: true));
      expect(root, isA<ConfigErrorApp>());
      expect((root as ConfigErrorApp).problem.code, ConfigProblem.apiUrlMissing.code);
    });

    test('release with a localhost or http address shows the config problem screen', () {
      final local = buildRootWidget(config(api: 'https://localhost/api', release: true));
      expect((local as ConfigErrorApp).problem.code, ConfigProblem.apiUrlLocal.code);

      final http = buildRootWidget(config(api: 'http://api.example.com/api', release: true));
      expect((http as ConfigErrorApp).problem.code, ConfigProblem.apiUrlNotHttps.code);
    });

    test('release with a valid https address starts the real app', () {
      final root = buildRootWidget(config(api: 'https://api.example.com/api/v1', release: true));
      expect(root, isA<MultiProvider>());
      expect(root, isNot(isA<ConfigErrorApp>()));
    });

    test('debug starts the real app even with nothing configured', () {
      expect(buildRootWidget(config()), isA<MultiProvider>());
      expect(buildRootWidget(config(api: 'http://127.0.0.1:4000/api/v1')), isA<MultiProvider>());
    });
  });
}
