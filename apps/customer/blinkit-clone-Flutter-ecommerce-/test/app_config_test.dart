import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Services/app_config.dart';
import 'package:ecom/UI/Widgets/Organisms/map_tile_config.dart';

AppConfig config({
  String define = '',
  String defineTiles = '',
  Map<String, String> dotenvValues = const {},
  bool release = false,
}) =>
    AppConfig(
      defineApiBaseUrl: define,
      defineMapTilesUrl: defineTiles,
      dotenvLookup: (key) => dotenvValues[key],
      isRelease: release,
    );

// Every spelling of "this machine / this network segment" that release must
// refuse, even over https. Dart does not normalise numeric IPv4 forms
// (InternetAddress.tryParse rejects 127.1, 0x7f.0.0.1 and 2130706433), so the
// guard parses them itself.
const localHostUrls = <String, String>{
  'localhost': 'https://localhost:4000/api/v1',
  'mixed case': 'https://LocalHost/api/v1',
  'uppercase scheme and host': 'HTTPS://LOCALHOST/api/v1',
  'trailing dot': 'https://localhost./api/v1',
  'percent-encoded trailing dot': 'https://localhost%2E/api/v1',
  '*.localhost': 'https://api.localhost/api/v1',
  '*.local': 'https://foo.local/api/v1',
  '*.local with trailing dot': 'https://foo.local./api/v1',
  '127.0.0.1': 'https://127.0.0.1/api/v1',
  '127.0.0.1 trailing dot': 'https://127.0.0.1./api/v1',
  '127.0.0.2': 'https://127.0.0.2/api/v1',
  '127.255.255.254': 'https://127.255.255.254/api/v1',
  '127.1 short form': 'https://127.1/api/v1',
  '127.0.1 short form': 'https://127.0.1/api/v1',
  'decimal integer': 'https://2130706433/api/v1',
  'hex integer': 'https://0x7f000001/api/v1',
  'hex dotted': 'https://0x7f.0.0.1/api/v1',
  'octal dotted': 'https://0177.0.0.1/api/v1',
  'octal integer': 'https://017700000001/api/v1',
  'bare 0': 'https://0/api/v1',
  '0.0.0.0': 'https://0.0.0.0/api/v1',
  '0.1.2.3 (this network)': 'https://0.1.2.3/api/v1',
  '10.0.2.2 emulator': 'https://10.0.2.2:4000/api/v1',
  '10.0.3.2 emulator': 'https://10.0.3.2:4000/api/v1',
  '10.0.2.2 in hex': 'https://0xa.0.2.2/api/v1',
  'link-local 169.254.1.1': 'https://169.254.1.1/api/v1',
  'link-local 169.254.169.254': 'https://169.254.169.254/api/v1',
  'ipv6 ::1': 'https://[::1]:4000/api/v1',
  'ipv6 long-form loopback': 'https://[0:0:0:0:0:0:0:1]/api/v1',
  'ipv6 padded loopback': 'https://[0000:0000:0000:0000:0000:0000:0000:0001]/api/v1',
  'ipv6 unspecified ::': 'https://[::]/api/v1',
  'ipv6 long-form unspecified': 'https://[0:0:0:0:0:0:0:0]/api/v1',
  'ipv6 link-local fe80::1': 'https://[fe80::1]/api/v1',
  'ipv6 link-local febf::1': 'https://[febf::1]/api/v1',
  'ipv6 link-local with zone': 'https://[fe80::1%25eth0]/api/v1',
  'ipv4-mapped loopback': 'https://[::ffff:127.0.0.1]/api/v1',
  'ipv4-mapped loopback hex': 'https://[::ffff:7f00:1]/api/v1',
  'ipv4-mapped unspecified': 'https://[::ffff:0.0.0.0]/api/v1',
  'ipv4-mapped link-local': 'https://[::ffff:169.254.1.1]/api/v1',
  'ipv4-mapped emulator alias': 'https://[::ffff:10.0.2.2]/api/v1',
  'ipv4-compatible loopback': 'https://[::7f00:1]/api/v1',
  'nat64 loopback': 'https://[64:ff9b::7f00:1]/api/v1',
  'userinfo before localhost': 'https://user@localhost/api/v1',
  'userinfo with password before 127.0.0.1': 'https://user:pw@127.0.0.1/api/v1',
  'decoy userinfo before localhost': 'https://api.example.com@localhost/api/v1',
  'surrounding whitespace': '  https://localhost/api/v1  ',
};

// Ordinary destinations that must keep working. Private LAN ranges are
// deliberately allowed: a private https staging host can be legitimate.
const validHostUrls = <String, String>{
  'plain host': 'https://api.example.com/api/v1',
  'country host': 'https://staging.example.co.lk/api/v1',
  'port and path': 'https://api.example.com:8443/blynk/api/v1',
  'public ipv4': 'https://8.8.8.8/api/v1',
  'public ipv4 with port': 'https://203.0.113.10:8443/api/v1',
  'localhost as a subdomain label': 'https://localhost.example.com/api/v1',
  'localhost prefix': 'https://localhosting.example.com/api/v1',
  'local as a name part': 'https://mylocal.example.com/api/v1',
  'localhost in the path only': 'https://api.example.com/localhost/api/v1',
  'localhost in the userinfo only': 'https://localhost@api.example.com/api/v1',
  'digits in a name': 'https://127.example.com/api/v1',
  'hex-looking name': 'https://0x7f.example.com/api/v1',
  'public ipv6': 'https://[2001:4860:4860::8888]/api/v1',
  'private LAN 192.168': 'https://192.168.1.20/api/v1',
  'uppercase scheme and host': 'HTTPS://API.EXAMPLE.COM/api/v1',
  'surrounding whitespace': '  https://api.example.com/api/v1  ',
};

void main() {
  group('apiBaseUrl precedence', () {
    test('a dart-define wins over dotenv and the fallback', () {
      final c = config(
        define: 'https://define.example.com/api/v1',
        dotenvValues: {'API_BASE_URL': 'https://dotenv.example.com/api/v1'},
      );
      expect(c.apiBaseUrl, 'https://define.example.com/api/v1');
    });

    test('dotenv is used when there is no dart-define', () {
      final c = config(dotenvValues: {'API_BASE_URL': '  https://dotenv.example.com/api/v1 '});
      expect(c.apiBaseUrl, 'https://dotenv.example.com/api/v1');
    });

    test('a blank dart-define and blank dotenv fall through to the debug fallback', () {
      final c = config(define: '  ', dotenvValues: {'API_BASE_URL': ''});
      expect(c.apiBaseUrl, 'http://localhost:4000/api/v1');
    });

    test('debug build with nothing configured uses the localhost fallback', () {
      expect(config().apiBaseUrl, AppConfig.debugApiBaseUrl);
    });

    test('release build with nothing configured never falls back to localhost', () {
      final c = config(release: true);
      expect(c.apiBaseUrl, isEmpty);
      expect(c.apiBaseUrl, isNot(contains('localhost')));
    });
  });

  group('mapTilesUrl precedence', () {
    test('dart-define wins over dotenv', () {
      final c = config(
        defineTiles: 'https://define.example.com/t.pmtiles',
        dotenvValues: {'MAP_TILES_URL': 'https://dotenv.example.com/t.pmtiles'},
      );
      expect(c.mapTilesUrl, 'https://define.example.com/t.pmtiles');
    });

    test('dotenv is used otherwise, trimmed', () {
      final c = config(dotenvValues: {'MAP_TILES_URL': ' https://dotenv.example.com/t.pmtiles\n'});
      expect(c.mapTilesUrl, 'https://dotenv.example.com/t.pmtiles');
    });

    test('nothing set is null (there is no fallback for tiles)', () {
      expect(config().mapTilesUrl, isNull);
      expect(config(dotenvValues: {'MAP_TILES_URL': '   '}).mapTilesUrl, isNull);
    });
  });

  group('release guard', () {
    ConfigProblem? problemFor(String api) => config(define: api, release: true).validate();

    test('a missing value is a problem', () {
      expect(problemFor('')?.code, ConfigProblem.apiUrlMissing.code);
    });

    for (final entry in localHostUrls.entries) {
      test('local host is a problem: ${entry.key}', () {
        expect(problemFor(entry.value)?.code, ConfigProblem.apiUrlLocal.code, reason: entry.value);
      });
    }

    for (final entry in validHostUrls.entries) {
      test('valid host stays valid: ${entry.key}', () {
        expect(problemFor(entry.value), isNull, reason: entry.value);
      });
    }

    test('the same host table is also refused when it comes from dotenv', () {
      for (final url in localHostUrls.values) {
        final c = config(dotenvValues: {'API_BASE_URL': url}, release: true);
        expect(c.validate()?.code, ConfigProblem.apiUrlLocal.code, reason: url);
      }
    });

    test('http is a problem', () {
      expect(problemFor('http://api.example.com/api/v1')?.code, ConfigProblem.apiUrlNotHttps.code);
      expect(problemFor('HTTP://api.example.com/api/v1')?.code, ConfigProblem.apiUrlNotHttps.code);
      expect(problemFor('http://8.8.8.8/api/v1')?.code, ConfigProblem.apiUrlNotHttps.code);
    });

    test('http on localhost reports the local host', () {
      expect(problemFor('http://localhost:4000/api/v1')?.code, ConfigProblem.apiUrlLocal.code);
    });

    test('garbage and host-less values are invalid', () {
      expect(problemFor('not a url')?.code, ConfigProblem.apiUrlInvalid.code);
      expect(problemFor('https://')?.code, ConfigProblem.apiUrlInvalid.code);
      expect(problemFor('https:localhost')?.code, ConfigProblem.apiUrlInvalid.code);
      expect(problemFor('api.example.com/api/v1')?.code, ConfigProblem.apiUrlInvalid.code);
    });

    test('a bad optional tiles URL never blocks the app; it is a warning', () {
      const api = 'https://api.example.com/api/v1';
      for (final tiles in [
        'http://tiles.example.com/a.pmtiles',
        'https://localhost/a.pmtiles',
        'https://127.1/a.pmtiles',
        'not a url',
      ]) {
        final c = config(define: api, defineTiles: tiles, release: true);
        expect(c.validate(), isNull, reason: tiles);
        expect(c.mapTilesProblem?.code, ConfigProblem.tilesUrlInvalid.code, reason: tiles);
        expect(resolveMapTilesUrlFromEnvironment(config: c), isNull, reason: tiles);
      }
    });

    test('a valid https tiles URL is used; an API problem stays fatal', () {
      final ok = config(
        define: 'https://api.example.com/api/v1',
        defineTiles: 'https://cdn.example.com/a.pmtiles',
        release: true,
      );
      expect(ok.validate(), isNull);
      expect(ok.mapTilesProblem, isNull);
      expect(resolveMapTilesUrlFromEnvironment(config: ok), 'https://cdn.example.com/a.pmtiles');

      final bad = config(
        define: 'https://localhost/api',
        defineTiles: 'https://cdn.example.com/a.pmtiles',
        release: true,
      );
      expect(bad.validate()?.code, ConfigProblem.apiUrlLocal.code);
    });

    test('problem codes are short and distinct', () {
      final codes = ConfigProblem.all.map((p) => p.code).toList();
      expect(codes.toSet().length, codes.length);
      for (final code in codes) {
        expect(code.length, lessThanOrEqualTo(24));
      }
    });
  });

  group('debug behaviour is unchanged', () {
    test('http and localhost are allowed', () {
      expect(config(dotenvValues: {'API_BASE_URL': 'http://10.0.2.2:4000/api/v1'}).validate(), isNull);
      expect(config().validate(), isNull);
      expect(config(define: 'http://127.0.0.1:4000/api/v1').validate(), isNull);
    });

    test('every local host in the table is allowed in debug', () {
      for (final url in localHostUrls.values) {
        expect(config(define: url).validate(), isNull, reason: url);
      }
    });

    test('a set but garbage tiles URL is not blocked (the map shows its own unavailable state)', () {
      expect(config(defineTiles: 'nope').validate(), isNull);
      expect(config(defineTiles: 'http://localhost:4000/t.pmtiles').mapTilesProblem, isNull);
    });

    test('http dev tiles stay usable in debug', () {
      final c = config(
        dotenvValues: {
          'API_BASE_URL': 'http://10.0.2.2:4000/api/v1',
          'MAP_TILES_URL': 'http://10.0.2.2:4000/t.pmtiles',
        },
      );
      expect(resolveMapTilesUrlFromEnvironment(config: c), 'http://10.0.2.2:4000/t.pmtiles');
    });
  });

  // NOTE: the compile-time `String.fromEnvironment('API_BASE_URL')` default
  // cannot be exercised in-process (its value is fixed when the test binary is
  // built), so precedence is tested through the injectable constructor above.
  // A typo in the define key would only show up in a real
  // `--dart-define-from-file` build: check it once on the first release build.
  group('real sources', () {
    tearDown(() => dotenv.testLoad(fileInput: ''));

    test('getApiBaseUrl reads dotenv through AppConfig', () {
      dotenv.testLoad(fileInput: 'API_BASE_URL=https://api.example.com/api/v1');
      expect(getApiBaseUrl(), 'https://api.example.com/api/v1');
    });

    test('getApiBaseUrl falls back to localhost in debug when dotenv is empty', () {
      dotenv.testLoad(fileInput: '');
      expect(getApiBaseUrl(), 'http://localhost:4000/api/v1');
    });

    test('the tiles URL is still derived from the API origin', () {
      dotenv.testLoad(fileInput: 'API_BASE_URL=https://api.example.com/api/v1');
      expect(resolveMapTilesUrlFromEnvironment(),
          'https://api.example.com/map-tiles/blynk-service-area.pmtiles');
    });

    test('nothing configured: the map is unavailable, never built from the debug localhost fallback', () {
      dotenv.testLoad(fileInput: '');
      expect(resolveMapTilesUrlFromEnvironment(), isNull);
      expect(config().configuredApiBaseUrl, isNull);
    });

    test('MAP_TILES_URL in dotenv overrides the derivation', () {
      dotenv.testLoad(
        fileInput: 'API_BASE_URL=https://api.example.com/api/v1\n'
            'MAP_TILES_URL=https://cdn.example.com/x.pmtiles',
      );
      expect(resolveMapTilesUrlFromEnvironment(), 'https://cdn.example.com/x.pmtiles');
    });
  });
}
