import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Organisms/map_tile_config.dart';

const _archive = '/map-tiles/blynk-service-area.pmtiles';

String _style({String url = 'pmtiles://__TILES_URL__', bool withMetadataMention = true}) => jsonEncode({
      'version': 8,
      if (withMetadataMention) 'metadata': {'blynk:tiles-url-placeholder': '__TILES_URL__'},
      'sources': {
        'protomaps': {'type': 'vector', 'url': url, 'maxzoom': 15, 'attribution': '© OpenStreetMap contributors'},
      },
      'layers': [
        {'id': 'background', 'type': 'background'},
      ],
    });

void main() {
  group('resolveMapTilesUrl', () {
    test('uses the explicit MAP_TILES_URL when it is a valid absolute http(s) URL', () {
      expect(
        resolveMapTilesUrl(configured: 'https://tiles.example.com/x/a.pmtiles', apiBaseUrl: 'https://api.example.com/api/v1'),
        'https://tiles.example.com/x/a.pmtiles',
      );
    });

    test('trims whitespace around the configured URL', () {
      expect(
        resolveMapTilesUrl(configured: '  https://t.example.com/a.pmtiles \n', apiBaseUrl: 'https://api.example.com/api/v1'),
        'https://t.example.com/a.pmtiles',
      );
    });

    test('derives from the API origin, dropping the /api/v1 path', () {
      expect(
        resolveMapTilesUrl(configured: null, apiBaseUrl: 'https://api.example.com/api/v1'),
        'https://api.example.com$_archive',
      );
    });

    test('keeps a non-default port and http scheme when deriving (dev)', () {
      expect(
        resolveMapTilesUrl(configured: '', apiBaseUrl: 'http://localhost:4000/api/v1'),
        'http://localhost:4000$_archive',
      );
      expect(
        resolveMapTilesUrl(configured: '   ', apiBaseUrl: 'http://10.0.2.2:4000/api/v1/'),
        'http://10.0.2.2:4000$_archive',
      );
    });

    test('an invalid explicit MAP_TILES_URL fails safe (null) rather than silently falling back', () {
      for (final bad in [
        'not a url',
        'tiles.example.com/a.pmtiles', // no scheme
        'ftp://tiles.example.com/a.pmtiles',
        'file:///sdcard/a.pmtiles',
        'asset://a.pmtiles',
        'pmtiles://https://tiles.example.com/a.pmtiles', // scheme is added by the style, not the config
        'https://',
        'https:///a.pmtiles',
        'https://tiles.example.com/__TILES_URL__',
      ]) {
        expect(resolveMapTilesUrl(configured: bad, apiBaseUrl: 'https://api.example.com/api/v1'), isNull, reason: bad);
      }
    });

    test('an unusable API base URL fails safe (null) when nothing is configured', () {
      for (final bad in ['', 'localhost:4000/api/v1', 'api.example.com', 'ftp://api.example.com/x', 'https://', '::::']) {
        expect(resolveMapTilesUrl(configured: null, apiBaseUrl: bad), isNull, reason: bad);
      }
    });
  });

  group('substituteTilesUrl', () {
    const tiles = 'https://api.example.com$_archive';

    test('replaces the placeholder in the source url with pmtiles://<absolute url>', () {
      final out = substituteTilesUrl(_style(), tiles)!;
      final decoded = jsonDecode(out) as Map<String, dynamic>;
      expect(decoded['sources']['protomaps']['url'], 'pmtiles://$tiles');
      // The rest of the style survives untouched.
      expect(decoded['version'], 8);
      expect(decoded['layers'], hasLength(1));
      expect(decoded['sources']['protomaps']['attribution'], '© OpenStreetMap contributors');
    });

    test('the output never leaves the placeholder in any source url', () {
      final out = jsonDecode(substituteTilesUrl(_style(), tiles)!) as Map<String, dynamic>;
      for (final s in (out['sources'] as Map).values) {
        expect((s as Map)['url'], isNot(contains('__TILES_URL__')));
      }
    });

    test('returns null when the style has no placeholder to replace (would render the wrong tiles)', () {
      expect(substituteTilesUrl(_style(url: 'pmtiles://https://elsewhere.example/a.pmtiles'), tiles), isNull);
    });

    test('returns null for an invalid tiles URL, so an unsubstituted style is never produced', () {
      expect(substituteTilesUrl(_style(), ''), isNull);
      expect(substituteTilesUrl(_style(), 'not a url'), isNull);
      expect(substituteTilesUrl(_style(), 'pmtiles://https://x.example/a.pmtiles'), isNull);
    });

    test('returns null for malformed / non-object / source-less style JSON', () {
      expect(substituteTilesUrl('{not json', tiles), isNull);
      expect(substituteTilesUrl('[]', tiles), isNull);
      expect(substituteTilesUrl('{"version":8}', tiles), isNull);
      expect(substituteTilesUrl('{"version":8,"sources":[]}', tiles), isNull);
    });

    test('a tiles URL containing JSON-special characters cannot break out of the string', () {
      final out = substituteTilesUrl(_style(), 'https://x.example.com/a"b\\c.pmtiles')!;
      final decoded = jsonDecode(out) as Map<String, dynamic>;
      expect(decoded['sources']['protomaps']['url'], startsWith('pmtiles://https://x.example.com/'));
    });
  });

  test('the real bundled style has exactly one source whose url is the placeholder', () {
    final raw = File('Assets/map/blynk_map_style.json').readAsStringSync();
    final decoded = jsonDecode(raw) as Map<String, dynamic>;
    expect((decoded['sources'] as Map).length, 1);
    expect(decoded['sources']['protomaps']['url'], 'pmtiles://$kTilesUrlPlaceholder');
    final out = substituteTilesUrl(raw, 'https://api.example.com$_archive');
    expect(out, isNotNull);
    final outDecoded = jsonDecode(out!) as Map<String, dynamic>;
    expect(outDecoded['sources']['protomaps']['url'], 'pmtiles://https://api.example.com$_archive');
    expect(outDecoded['layers'], decoded['layers']);
  });
}
