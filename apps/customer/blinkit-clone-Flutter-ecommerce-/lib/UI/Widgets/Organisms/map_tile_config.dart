import 'dart:convert';

import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';

/// Tile-source configuration for the map (pure functions, no map SDK).
///
/// The bundled style (Assets/map/blynk_map_style.json) carries the placeholder
/// `pmtiles://__TILES_URL__` as its vector source url. Native MapLibre cannot
/// read a PMTiles archive from the app bundle, so the archive is fetched over
/// HTTP(S) from the backend at `{origin}/map-tiles/blynk-service-area.pmtiles`
/// (docs/06-deployment/map-tile-hosting-setup.md, sections 5 and 8.1).
///
/// Configuration (both optional, neither is a secret; `.env` is git-ignored):
///   MAP_TILES_URL  absolute http(s) URL of the archive. Overrides derivation,
///                  e.g. to serve it from a CDN. Ignored when empty.
///   API_BASE_URL   (existing key) when MAP_TILES_URL is empty, the archive URL
///                  is this URL's origin + /map-tiles/blynk-service-area.pmtiles
///                  (the /api/v1 path is dropped: the archive is served at the
///                  API root, not under the versioned prefix).

const String kTilesUrlPlaceholder = '__TILES_URL__';
const String kMapTilesPath = '/map-tiles/blynk-service-area.pmtiles';
const String kMapStyleAsset = 'Assets/map/blynk_map_style.json';

/// True for an absolute http(s) URL with a host and no unsubstituted token:
/// the only shape `pmtiles://<url>` can use on native MapLibre.
bool _isAbsoluteHttpUrl(String value) {
  if (value.contains(kTilesUrlPlaceholder)) return false;
  final uri = Uri.tryParse(value);
  if (uri == null) return false;
  return (uri.scheme == 'http' || uri.scheme == 'https') && uri.host.isNotEmpty;
}

/// The archive URL to substitute into the style, or null when none can be
/// determined (the caller must then show a "map unavailable" state, never a
/// map built from a guessed URL).
///
/// A *set but invalid* [configured] value is a misconfiguration and yields
/// null rather than silently falling back to a different host.
String? resolveMapTilesUrl({required String? configured, required String apiBaseUrl}) {
  final explicit = configured?.trim() ?? '';
  if (explicit.isNotEmpty) return _isAbsoluteHttpUrl(explicit) ? explicit : null;

  final base = apiBaseUrl.trim();
  if (!_isAbsoluteHttpUrl(base)) return null;
  final uri = Uri.parse(base);
  return Uri(scheme: uri.scheme, host: uri.host, port: uri.hasPort ? uri.port : null).toString() + kMapTilesPath;
}

/// Reads MAP_TILES_URL and API_BASE_URL from the app's dotenv and resolves the
/// archive URL. Null when dotenv was never loaded or nothing usable is set.
String? resolveMapTilesUrlFromEnvironment() {
  try {
    return resolveMapTilesUrl(configured: dotenv.env['MAP_TILES_URL'], apiBaseUrl: getApiBaseUrl());
  } catch (_) {
    return null;
  }
}

bool _sourceUrlsClean(Map<String, dynamic> sources) {
  for (final source in sources.values) {
    if (source is Map && source['url'] is String && (source['url'] as String).contains(kTilesUrlPlaceholder)) {
      return false;
    }
  }
  return true;
}

/// Replaces the placeholder in every source url of [styleJson] with
/// [tilesUrl] and returns the style as a JSON string, or null when it cannot
/// be done safely: invalid [tilesUrl], unparsable / source-less style, no
/// placeholder found (the style would silently point at other tiles), or any
/// source url still carrying the token afterwards.
///
/// The style is decoded and re-encoded (not string-replaced) so the URL can
/// never break out of its JSON string. The placeholder also appears once in
/// the style's `metadata` as documentation; that inert copy is left alone.
String? substituteTilesUrl(String styleJson, String tilesUrl) {
  if (!_isAbsoluteHttpUrl(tilesUrl)) return null;
  final Object? decoded;
  try {
    decoded = jsonDecode(styleJson);
  } catch (_) {
    return null;
  }
  if (decoded is! Map<String, dynamic>) return null;
  final sources = decoded['sources'];
  if (sources is! Map<String, dynamic>) return null;

  var replaced = 0;
  for (final source in sources.values) {
    if (source is! Map) continue;
    final url = source['url'];
    if (url is String && url.contains(kTilesUrlPlaceholder)) {
      source['url'] = url.replaceAll(kTilesUrlPlaceholder, tilesUrl);
      replaced++;
    }
  }
  if (replaced == 0 || !_sourceUrlsClean(sources)) return null;
  return jsonEncode(decoded);
}
