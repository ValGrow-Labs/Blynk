// Live pipeline test for the live-rider-location feature: the REAL Customer
// `LocationProvider` (over the real Dio opener, the real token storage and
// real HTTP/SSE) against a REAL running backend and REAL Postgres.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT. This verifies the TRANSPORT,
// AUTHORIZATION and LIFECYCLE pipeline only: rider API -> backend -> database
// -> SSE stream -> customer provider. There is no physical device here, so no
// GPS and no background tracking is involved or claimed. Every coordinate is
// POSTed through the real rider API by this test and is a "test input to the
// pipeline", never a location fix. The physical-device scenarios stay
// BLOCKED/PENDING in docs/06-deployment/rider-background-tracking-device-
// verification.md.
//
// Nothing is mocked. The store side (ADMIN / PACKING_STAFF / RIDER) signs in
// through the real OTP (or refresh) flow exactly as the prior order-lifecycle
// harness does, every backend call asserts its HTTP status so a harness
// problem can never be mistaken for a feature problem, and this test never
// builds a widget or a map (the Windows desktop target has no maplibre_gl).
//
// Run with the backend up (and, for the restart scenario, under
// backend_ctl.cjs so this test can ask for a stop/start):
//   flutter test integration_test/live_location_tracking_flow_test.dart \
//     -d windows --timeout 30m \
//     --dart-define=E2E_ARTIFACT_DIR=<dir> --dart-define=E2E_CTRL_DIR=<dir>
//
// --dart-define=E2E_ARTIFACT_DIR=<dir> makes the run write a manifest
// (run_v1a_*.json) of everything it created so the out-of-repo cleanup script
// removes exactly those rows. --dart-define=E2E_CTRL_DIR=<dir> enables the
// backend stop/start scenario; without it that scenario is skipped.
// --dart-define=E2E_API_BASE=<url> points the run at another server.
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Models/rider_location_model.dart';
import 'package:ecom/Services/Providers/location.provider.dart';

const _apiBase = String.fromEnvironment('E2E_API_BASE', defaultValue: 'http://localhost:4000/api/v1');

/// Seeded operations accounts (backend `src/database/seeds/dev_seed.ts`).
const _adminPhone = '+94775551122';
const _staffPhone = '+94774443322';
const _riderPhone = '+94779876543';

const _artifactDir = String.fromEnvironment('E2E_ARTIFACT_DIR');
const _ctrlDir = String.fromEnvironment('E2E_CTRL_DIR');

/// The manifest's customer id (set once customer 1 has signed in).
String _customerUserId = '';

/// The server's per-delivery rate floor is 5 s; this is the wait after an
/// accepted write, measured from when its response arrived (the server
/// stamped it earlier still), before the next legitimate write.
const _rateFloorWait = Duration(milliseconds: 5400);

/// The server re-checks trackability every 15 s; a state change closes an
/// open stream within one interval, so allow that plus slack.
const _heartbeatWait = Duration(seconds: 30);

// ----------------------------------------------------------------- observations
final List<String> _observations = [];

void _obs(String scenario, String message) {
  final line = '[$scenario] $message';
  // ignore: avoid_print
  print(line);
  _observations.add(line);
}

// ------------------------------------------------------------------ polling
Future<bool> _until(
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 10),
  Duration poll = const Duration(milliseconds: 50),
}) async {
  final sw = Stopwatch()..start();
  while (sw.elapsed < timeout) {
    if (condition()) return true;
    await Future<void>.delayed(poll);
  }
  return condition();
}

/// Asserts [condition] stays true for the whole of [duration].
Future<void> _holds(bool Function() condition, Duration duration, String reason) async {
  final sw = Stopwatch()..start();
  while (sw.elapsed < duration) {
    expect(condition(), isTrue, reason: reason);
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
  expect(condition(), isTrue, reason: reason);
}

// --------------------------------------------------------------------- HTTP
Map<String, dynamic> _map(Object? v) => (v as Map).cast<String, dynamic>();

String _errorCode(Response<dynamic> r) {
  final data = r.data;
  if (data is Map && data['error'] is Map) return '${(data['error'] as Map)['code']}';
  return '';
}

void _expectStatus(Response<dynamic> r, int status, String what) {
  expect(r.statusCode, status, reason: '$what -> ${r.statusCode} ${r.data}');
}

void _expectRaw(({int status, String body}) raw, int status, String what) {
  expect(raw.status, status, reason: '$what -> ${raw.status} ${raw.body}');
}

class _Session {
  _Session({required this.phone, required this.userId, required this.access, required this.refresh})
      : issuedAt = DateTime.now();
  final String phone;
  final String userId;
  String access;
  String refresh;
  DateTime issuedAt;
}

/// One Dio that never throws on a status, so every call's status can be
/// asserted. Access tokens live 15 minutes; [refreshOpsIfOld] renews the ones a
/// long run is still using.
class _Backend {
  _Backend()
      : _dio = Dio(BaseOptions(
          baseUrl: _apiBase,
          validateStatus: (_) => true,
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 25),
        ));

  final Dio _dio;
  final Map<String, _Session> ops = {};

  Future<Response<dynamic>> call(String method, String path, {String? token, Object? data}) {
    return _dio.request<dynamic>(
      path,
      data: data,
      options: Options(method: method, headers: {if (token != null) 'Authorization': 'Bearer $token'}),
    );
  }

  Future<Response<dynamic>> as(String phone, String method, String path, {Object? data}) =>
      call(method, path, token: ops[phone]!.access, data: data);

  File? _sessionFile(String phone) => _artifactDir.isEmpty
      ? null
      : File('$_artifactDir${Platform.pathSeparator}ops_session_${phone.replaceAll('+', '')}.json');

  /// Renews a stored session (POST /auth/refresh) when there is one, like the
  /// Admin/Inventory/Rider apps; the backend allows only three OTP requests per
  /// phone per hour, so a fresh OTP is the fallback, not the default.
  Future<_Session> opsSignIn(String phone, String expectedRole) async {
    final file = _sessionFile(phone);
    if (file != null && file.existsSync()) {
      try {
        final stored = (jsonDecode(file.readAsStringSync()) as Map)['refresh_token'] as String?;
        if (stored != null) {
          final refreshed = await call('POST', '/auth/refresh', data: {'refresh_token': stored});
          if (refreshed.statusCode == 200) {
            final d = _map(_map(refreshed.data)['data']);
            final me = await call('GET', '/auth/me', token: d['access_token'] as String);
            if (me.statusCode == 200) {
              final user = _map(_map(me.data)['data']);
              file.writeAsStringSync(jsonEncode({'phone': phone, 'refresh_token': d['refresh_token']}));
              expect(user['role'], expectedRole, reason: 'seeded account $phone must be $expectedRole');
              return ops[phone] = _Session(
                phone: phone,
                userId: user['id'] as String,
                access: d['access_token'] as String,
                refresh: d['refresh_token'] as String,
              );
            }
          }
        }
      } catch (_) {/* fall through to OTP */}
      file.deleteSync();
    }
    final s = await otpSignIn(phone);
    file?.parent.createSync(recursive: true);
    file?.writeAsStringSync(jsonEncode({'phone': phone, 'refresh_token': s.refresh}));
    return ops[phone] = s;
  }

  /// A real OTP sign-in (dev mode returns the OTP in the request response).
  Future<_Session> otpSignIn(String phone) async {
    final request = await call('POST', '/auth/otp/request', data: {'phone': phone});
    _expectStatus(request, 200, 'POST /auth/otp/request $phone');
    final devOtp = _map(_map(request.data)['data'])['dev_otp'] as String?;
    expect(devOtp, isNotNull, reason: 'no dev_otp for $phone - is the backend in dev mode?');
    final verify = await call('POST', '/auth/otp/verify', data: {'phone': phone, 'otp': devOtp});
    _expectStatus(verify, 200, 'POST /auth/otp/verify $phone');
    final d = _map(_map(verify.data)['data']);
    return _Session(
      phone: phone,
      userId: _map(d['user'])['id'] as String,
      access: d['access_token'] as String,
      refresh: d['refresh_token'] as String,
    );
  }

  Future<void> refreshOpsIfOld() async {
    const roles = {_adminPhone: 'ADMIN', _staffPhone: 'PACKING_STAFF', _riderPhone: 'RIDER'};
    for (final e in roles.entries) {
      final s = ops[e.key];
      if (s == null || DateTime.now().difference(s.issuedAt) > const Duration(minutes: 8)) {
        await opsSignIn(e.key, e.value);
      }
    }
  }
}

// ---------------------------------------------------------------- test points
/// One point this test feeds to the pipeline through the real rider API.
class _Pt {
  _Pt(this.lat, this.lng, {this.acc = 10.0, DateTime? at, Duration age = Duration.zero})
      : capturedAt = DateTime.fromMillisecondsSinceEpoch(
          (at ?? DateTime.now().toUtc()).millisecondsSinceEpoch - age.inMilliseconds,
          isUtc: true,
        );
  final double lat, lng, acc;
  final DateTime capturedAt;

  Map<String, dynamic> get body =>
      {'latitude': lat, 'longitude': lng, 'accuracy': acc, 'captured_at': capturedAt.toIso8601String()};

  @override
  String toString() => '($lat, $lng ±$acc @ ${capturedAt.toIso8601String()})';
}

bool _isPoint(RiderLocationPoint? p, _Pt expected) =>
    p != null &&
    p.latitude == expected.lat &&
    p.longitude == expected.lng &&
    p.accuracy == expected.acc &&
    p.capturedAt.millisecondsSinceEpoch == expected.capturedAt.millisecondsSinceEpoch;

// -------------------------------------------------------------- provider view
class _Snap {
  _Snap(this.lat, this.lng, this.capturedAt, this.closed, this.unavailable) : at = DateTime.now();
  final double? lat, lng;
  final DateTime? capturedAt;
  final bool closed, unavailable;
  final DateTime at;
  @override
  String toString() => '(${lat ?? '-'}, ${lng ?? '-'} closed=$closed unavailable=$unavailable)';
}

/// The real provider plus a recording of every distinct state it ever showed.
class _Tracker {
  _Tracker(this.name, this.provider, {this.opens}) {
    provider.addListener(_onChange);
  }
  final String name;
  final LocationProvider provider;
  final _Opens? opens;
  final List<_Snap> history = [];

  void _onChange() {
    final c = provider.current;
    final snap = _Snap(c?.latitude, c?.longitude, c?.capturedAt, provider.closed, provider.unavailable);
    if (history.isNotEmpty) {
      final l = history.last;
      if (l.lat == snap.lat &&
          l.lng == snap.lng &&
          l.capturedAt == snap.capturedAt &&
          l.closed == snap.closed &&
          l.unavailable == snap.unavailable) {
        return;
      }
    }
    history.add(snap);
  }

  RiderLocationPoint? get current => provider.current;

  /// Distinct non-null points, in the order they were shown.
  List<_Snap> get pointsShown => history.where((s) => s.lat != null).toList();

  bool everShowed(double lat, double lng) => history.any((s) => s.lat == lat && s.lng == lng);

  /// The marker must never move backwards in time.
  void expectMonotonic() {
    DateTime? last;
    for (final s in history) {
      if (s.capturedAt == null) continue;
      if (last != null) {
        expect(s.capturedAt!.isBefore(last), isFalse,
            reason: '$name: current moved backwards (${s.capturedAt} after $last); history=$history');
      }
      last = s.capturedAt;
    }
  }

  void dispose() {
    provider.removeListener(_onChange);
    provider.dispose();
  }
}

class _Opens {
  int n = 0;
}

/// A provider whose opener is exactly the production one
/// (`openLocationStream(ApiService.dio, ...)`, which is what the default
/// constructor uses) plus a counter, so "no reconnect storm" can be asserted.
_Tracker _counting(String name, {Dio? dio}) {
  final opens = _Opens();
  final provider = LocationProvider(opener: (orderId) {
    opens.n++;
    return openLocationStream(dio ?? ApiService.dio, orderId);
  });
  return _Tracker(name, provider, opens: opens);
}

/// The stock provider, constructed the way the app constructs it.
_Tracker _stock(String name) => _Tracker(name, LocationProvider());

// ------------------------------------------------------------------- the test
class _Staged {
  _Staged(this.orderId, this.deliveryId, this.total);
  final String orderId;
  String deliveryId;
  final num total;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  final startedAt = DateTime.now().toUtc().subtract(const Duration(minutes: 1)).toIso8601String();
  final suffix = (DateTime.now().millisecondsSinceEpoch % 100000).toString().padLeft(5, '0');
  final phone1 = '+9471${suffix.padLeft(7, '0')}';
  final phone2 = '+9472${suffix.padLeft(7, '0')}';
  final orderIds = <String>[];
  final extraCustomers = <Map<String, String>>[];
  final backend = _Backend();
  final lastAccepted = <String, Stopwatch>{};
  final trackers = <_Tracker>[];

  late _Session customer1;
  late String riderId;
  late String addressId;
  late String productId;
  late DateTime customerTokenAt;

  late _Staged order1; // scenarios 2-7 (walks all the way to DELIVERED)
  late _Staged order2; // scenario 8 (FAILED -> re-stage -> new delivery)

  void writeManifest() {
    if (_artifactDir.isEmpty) return;
    final dir = Directory(_artifactDir);
    if (!dir.existsSync()) dir.createSync(recursive: true);
    File('$_artifactDir${Platform.pathSeparator}run_v1a_$suffix.json').writeAsStringSync(
      const JsonEncoder.withIndent('  ').convert({
        'started_at': startedAt,
        'customer_phone': phone1,
        'customer_user_id': _customerUserId,
        'order_ids': orderIds,
        'extra_customers': extraCustomers,
        'ops_phones': [_adminPhone, _staffPhone, _riderPhone],
      }),
    );
  }

  // ---- customer 1 helpers: the token of record lives in TokenStorage, the
  // same place the app (and therefore the provider's opener) reads it.
  Future<Response<dynamic>> customerCall(String method, String path, {Object? data}) async {
    final token = await TokenStorage.getAccessToken();
    return backend.call(method, path, token: token, data: data);
  }

  Future<void> refreshCustomerIfOld() async {
    if (DateTime.now().difference(customerTokenAt) < const Duration(minutes: 8)) return;
    final refresh = await TokenStorage.getRefreshToken();
    final r = await backend.call('POST', '/auth/refresh', data: {'refresh_token': refresh});
    _expectStatus(r, 200, 'POST /auth/refresh (customer 1)');
    final d = _map(_map(r.data)['data']);
    await TokenStorage.saveTokens(
      accessToken: d['access_token'] as String,
      refreshToken: d['refresh_token'] as String,
    );
    customerTokenAt = DateTime.now();
  }

  Future<void> beginScenario() async {
    await backend.refreshOpsIfOld();
    await refreshCustomerIfOld();
  }

  // ---- store-side helpers
  Future<String> assign(String orderId, String label) async {
    final res = await backend.as(_adminPhone, 'POST', '/admin/orders/$orderId/assign-rider', data: {'rider_id': riderId});
    _expectStatus(res, 200, 'POST assign-rider ($label)');
    return _map(_map(res.data)['data']['delivery'])['id'] as String;
  }

  Future<_Staged> stageOrder(String label) async {
    final placed = await customerCall('POST', '/orders', data: {
      'address_id': addressId,
      'items': [
        {'product_id': productId, 'quantity': 1}
      ],
    });
    _expectStatus(placed, 201, 'POST /orders ($label)');
    final order = _map(_map(placed.data)['data']['order']);
    final orderId = order['id'] as String;
    orderIds.add(orderId);
    writeManifest();

    final detail = await backend.as(_adminPhone, 'GET', '/admin/orders/$orderId');
    _expectStatus(detail, 200, 'GET /admin/orders/:id ($label)');
    final items = _map(_map(detail.data)['data']['order'])['items'] as List;
    expect(items, isNotEmpty);
    for (final item in items) {
      final sourced = await backend.as(_staffPhone, 'POST', '/admin/orders/$orderId/items/${item['id']}/source',
          data: {'actual_unit_cost': 450});
      _expectStatus(sourced, 200, 'POST source item ($label)');
    }
    final packed = await backend.as(_staffPhone, 'PATCH', '/admin/orders/$orderId/status', data: {'status': 'PACKED'});
    _expectStatus(packed, 200, 'PATCH PACKED ($label)');

    final deliveryId = await assign(orderId, label);
    return _Staged(orderId, deliveryId, num.parse('${order['total_amount']}'));
  }

  Future<Response<dynamic>> riderStatus(String deliveryId, String status, {String? failureReason}) => backend.as(
        _riderPhone,
        'PATCH',
        '/riders/deliveries/$deliveryId/status',
        data: failureReason == null ? {'status': status} : {'status': status, 'failure_reason': failureReason},
      );

  Future<void> riderStep(String deliveryId, String status, {String? failureReason}) async {
    final r = await riderStatus(deliveryId, status, failureReason: failureReason);
    _expectStatus(r, 200, 'PATCH /riders/deliveries/:id/status $status');
  }

  Future<void> collectCod(_Staged s) async {
    final r = await backend.as(_riderPhone, 'POST', '/riders/deliveries/${s.deliveryId}/collect-cod',
        data: {'amount': s.total});
    _expectStatus(r, 200, 'POST collect-cod');
  }

  Future<Response<dynamic>> postRaw(String deliveryId, Object? body, {String? token, bool asRider = true}) =>
      backend.call('POST', '/riders/deliveries/$deliveryId/location',
          token: asRider ? backend.ops[_riderPhone]!.access : token, data: body);

  Future<Response<dynamic>> postPoint(String deliveryId, _Pt p) => postRaw(deliveryId, p.body);

  /// A legitimate write: waits out the rate floor, POSTs, asserts 202 accepted.
  Future<void> postAccepted(String deliveryId, _Pt p) async {
    final sw = lastAccepted[deliveryId];
    if (sw != null) {
      final remaining = _rateFloorWait - sw.elapsed;
      if (remaining > Duration.zero) await Future<void>.delayed(remaining);
    }
    final r = await postPoint(deliveryId, p);
    _expectStatus(r, 202, 'rider POST location $p');
    expect(_map(_map(r.data)['data'])['accepted'], isTrue, reason: 'rider POST $p -> ${r.data}');
    lastAccepted[deliveryId] = Stopwatch()..start();
  }

  void expectNotAccepted(Response<dynamic> r, String reason, String what) {
    _expectStatus(r, 202, what);
    final d = _map(_map(r.data)['data']);
    expect(d['accepted'], isFalse, reason: '$what -> ${r.data}');
    expect(d['reason'], reason, reason: '$what -> ${r.data}');
  }

  /// The DB-side latest point, as the customer's own stream reports it: a
  /// fresh provider's initial snapshot is the row currently stored.
  Future<RiderLocationPoint?> snapshotViaNewWatch(String orderId) async {
    final t = _stock('snapshot-probe');
    t.provider.watch(orderId);
    await _until(() => t.current != null || t.provider.closed || t.provider.unavailable,
        timeout: const Duration(seconds: 8));
    final p = t.current;
    t.dispose();
    return p;
  }

  final rawDio = Dio(BaseOptions(
    baseUrl: _apiBase,
    validateStatus: (_) => true,
    responseType: ResponseType.plain,
    receiveTimeout: const Duration(seconds: 25),
  ));

  /// GET the stream once, as plain HTTP. For a stream the server ends (closed
  /// at connect) this returns the whole body; for a refusal, the JSON error.
  Future<({int status, String body})> rawStream(String orderId, {String? token}) async {
    final r = await rawDio.get<String>(
      '/orders/$orderId/location/stream',
      options: Options(headers: {'Accept': 'text/event-stream', if (token != null) 'Authorization': 'Bearer $token'}),
    );
    return (status: r.statusCode ?? 0, body: r.data ?? '');
  }

  String closedReason(String body) {
    final m = RegExp(r'event: closed\ndata: (\{.*\})').firstMatch(body);
    return m == null ? '' : '${(jsonDecode(m.group(1)!) as Map)['reason']}';
  }

  _Tracker track(_Tracker t) {
    trackers.add(t);
    return t;
  }

  setUpAll(() async {
    // The provider's real opener resolves its base URL through getApiBaseUrl()
    // (the bundled .env's API_BASE_URL, default http://localhost:4000/api/v1).
    // Load the same .env asset the app loads; if this run targets another
    // server (E2E_API_BASE) point the same setting at it so the provider and
    // the store-side calls always talk to one backend.
    try {
      await dotenv.load(fileName: '.env');
    } catch (_) {
      dotenv.testLoad(fileInput: 'API_BASE_URL=$_apiBase');
    }
    if (getApiBaseUrl() != _apiBase) {
      dotenv.testLoad(fileInput: 'API_BASE_URL=$_apiBase');
    }
    ApiService.resetDio();
    expect(ApiService.dio.options.baseUrl, _apiBase,
        reason: 'the provider\'s real Dio must target the same backend as the store-side calls');
    _obs('setup', 'API base = $_apiBase (bundled .env agrees: ${getApiBaseUrl() == _apiBase})');
  });

  tearDownAll(() async {
    for (final t in trackers) {
      try {
        t.dispose();
      } catch (_) {}
    }
    writeManifest();
    if (_artifactDir.isNotEmpty) {
      File('$_artifactDir${Platform.pathSeparator}v1a_observations_$suffix.txt')
          .writeAsStringSync(_observations.join('\n'));
    }
  });

  const scenarioTimeout = Timeout(Duration(minutes: 8));

  // ===========================================================================
  test('1. setup (API): customer, address, order placed, packed, rider assigned', () async {
    for (final e in {_adminPhone: 'ADMIN', _staffPhone: 'PACKING_STAFF', _riderPhone: 'RIDER'}.entries) {
      await backend.opsSignIn(e.key, e.value);
    }
    customer1 = await backend.otpSignIn(phone1);
    _customerUserId = customer1.userId;
    writeManifest();
    // The customer's session lives where the app keeps it, so the provider's
    // real opener authenticates exactly as it does in the app.
    await TokenStorage.saveTokens(accessToken: customer1.access, refreshToken: customer1.refresh);
    customerTokenAt = DateTime.now();
    expect(await TokenStorage.getAccessToken(), customer1.access);

    final riders = await backend.as(_adminPhone, 'GET', '/admin/riders');
    _expectStatus(riders, 200, 'GET /admin/riders');
    final rows = _map(_map(riders.data)['data'])['riders'] as List;
    expect(rows, isNotEmpty, reason: 'the dev seed must have an active rider');
    riderId = rows.first['id'] as String;
    _obs('S1', 'active riders in the seed: ${rows.length}');

    // An address inside the service radius: the seeded hub area.
    final addr = await customerCall('POST', '/me/addresses', data: {
      'label': 'Live tracking E2E',
      'recipient_name': 'QA Tester',
      'recipient_phone': phone1,
      'address_line1': 'No. 12, Test Lane',
      'city': 'Dharga Town',
      'latitude': 6.4382,
      'longitude': 80.0274,
      'is_default': true,
    });
    _expectStatus(addr, 201, 'POST /me/addresses');
    addressId = _map(_map(addr.data)['data']['address'])['id'] as String;

    final catalog = await backend.call('GET', '/catalog/products?limit=5');
    _expectStatus(catalog, 200, 'GET /catalog/products');
    productId = (_map(catalog.data)['data']['products'] as List).first['id'] as String;

    order1 = await stageOrder('order1');
    final seen = await customerCall('GET', '/orders/${order1.orderId}');
    _expectStatus(seen, 200, 'GET /orders/:id');
    final o = _map(_map(seen.data)['data']['order']);
    expect(o['order_status'], 'PACKED');
    expect(_map(o['delivery'])['assignment_status'], 'ASSIGNED');
    _obs('S1', 'PASS order1=${order1.orderId} delivery1=${order1.deliveryId} (PACKED, rider ASSIGNED)');
  }, timeout: scenarioTimeout);

  // ===========================================================================
  test('2. not trackable before pickup: stream closes not_trackable, rider POST is 409', () async {
    await beginScenario();
    final early = _Pt(6.4352, 80.0245);
    final post = await postPoint(order1.deliveryId, early);
    _expectStatus(post, 409, 'rider POST before pickup');
    expect(_errorCode(post), 'DELIVERY_NOT_TRACKABLE');

    final raw = await rawStream(order1.orderId, token: await TokenStorage.getAccessToken());
    _expectRaw(raw, 200, 'raw stream (assigned, not yet picked up)');
    expect(closedReason(raw.body), 'not_trackable', reason: 'raw body: ${raw.body}');
    expect(raw.body.contains('event: location'), isFalse);

    final t = track(_counting('S2'));
    t.provider.watch(order1.orderId);
    expect(await _until(() => t.provider.closed, timeout: const Duration(seconds: 12)), isTrue,
        reason: 'the provider must end closed on the server\'s not_trackable frame');
    expect(t.current, isNull);
    expect(t.provider.unavailable, isFalse);
    await Future<void>.delayed(const Duration(seconds: 5)); // > the 1 s + 2 s backoff a storm would show
    expect(t.opens!.n, 1, reason: 'a server "closed" is terminal: no reconnect storm');
    expect(t.provider.closed, isTrue);
    expect(t.current, isNull);
    t.dispose();
    trackers.remove(t);
    _obs('S2', 'PASS rider POST=409 DELIVERY_NOT_TRACKABLE; raw stream 200 + "closed: not_trackable"; '
        'provider closed=true current=null, opened the stream exactly ${t.opens!.n}x over 5+ s');
  }, timeout: scenarioTimeout);

  // ===========================================================================
  late _Tracker primary;
  late _Pt pointA, pointB;

  test('3. pickup -> real round trip: A then B reach the provider exactly, marker moves', () async {
    await beginScenario();
    await riderStep(order1.deliveryId, 'PICKED_UP');
    final seen = await customerCall('GET', '/orders/${order1.orderId}');
    expect(_map(_map(seen.data)['data']['order'])['order_status'], 'OUT_FOR_DELIVERY');

    primary = track(_stock('main')); // the stock provider, default opener
    primary.provider.watch(order1.orderId);
    await Future<void>.delayed(const Duration(milliseconds: 1500)); // let the stream open
    expect(primary.current, isNull, reason: 'no point has been sent yet: nothing may be invented');
    expect(primary.provider.closed, isFalse);

    pointA = _Pt(6.4352, 80.0245, acc: 12.5);
    final sentA = Stopwatch()..start();
    await postAccepted(order1.deliveryId, pointA);
    expect(await _until(() => primary.current != null, timeout: const Duration(seconds: 8)), isTrue,
        reason: 'the point A must reach the provider over the real SSE stream');
    final latencyA = sentA.elapsedMilliseconds;
    expect(_isPoint(primary.current, pointA), isTrue,
        reason: 'provider has ${primary.current?.latitude},${primary.current?.longitude} '
            '±${primary.current?.accuracy} @${primary.current?.capturedAt}, sent $pointA');
    expect(primary.provider.freshness, LocationFreshness.live);

    pointB = _Pt(6.4360, 80.0252, acc: 9.0); // moved
    final sentB = Stopwatch()..start();
    await postAccepted(order1.deliveryId, pointB); // waits out the 5 s floor first
    expect(await _until(() => _isPoint(primary.current, pointB), timeout: const Duration(seconds: 8)), isTrue,
        reason: 'the marker must move to B; provider has ${primary.current?.latitude},${primary.current?.longitude}');
    final latencyB = sentB.elapsedMilliseconds;
    expect(primary.provider.freshness, LocationFreshness.live);
    expect(primary.pointsShown.map((s) => [s.lat, s.lng]).toList(), [
      [pointA.lat, pointA.lng],
      [pointB.lat, pointB.lng],
    ], reason: 'exactly A then B, nothing else');
    primary.expectMonotonic();

    // The DB-side latest, as the stream reports it to a brand-new watcher.
    final stored = await snapshotViaNewWatch(order1.orderId);
    expect(_isPoint(stored, pointB), isTrue, reason: 'stored latest must be B, snapshot was ${stored?.latitude}');
    _obs('S3', 'PASS A=$pointA arrived exactly (live); after the 5 s floor B=$pointB arrived exactly; '
        'history [A,B]; a fresh watcher\'s initial snapshot == B (stored latest). '
        'POST->provider incl. floor wait: A ${latencyA}ms, B ${latencyB}ms');
  }, timeout: scenarioTimeout);

  // ===========================================================================
  late _Pt pointC2; // the last accepted point of scenario 4

  test('4. duplicate / out-of-order / rate floor / future / stale: provider never regresses', () async {
    await beginScenario();
    // A fresh accepted write starts the 5 s window every check below runs inside.
    final base = _Pt(6.4366, 80.0258, acc: 8.0);
    await postAccepted(order1.deliveryId, base);
    expect(await _until(() => _isPoint(primary.current, base)), isTrue);
    final shown = primary.history.length;

    // duplicate: same captured_at
    expectNotAccepted(await postPoint(order1.deliveryId, base), 'not_newer', 'resend of the same point');

    // out of order: an older captured_at with different coordinates
    final older = _Pt(6.5000, 80.1000, at: base.capturedAt, age: const Duration(seconds: 30));
    expectNotAccepted(await postPoint(order1.deliveryId, older), 'not_newer', 'older captured_at');

    // very old (10 min): a silent no-op against a newer stored point
    final ancient = _Pt(6.6000, 80.2000, age: const Duration(minutes: 10));
    expectNotAccepted(await postPoint(order1.deliveryId, ancient), 'not_newer', 'very old captured_at');

    // high frequency: a genuinely newer point, but inside the 5 s window
    final tooSoon = _Pt(6.4370, 80.0262, acc: 7.0);
    expectNotAccepted(await postPoint(order1.deliveryId, tooSoon), 'rate_limited', 'write inside the 5 s floor');

    // more than 60 s in the future: a clock-skew problem, refused outright
    final future = _Pt(6.7000, 80.3000, at: DateTime.now().toUtc().add(const Duration(seconds: 120)));
    final futureRes = await postPoint(order1.deliveryId, future);
    _expectStatus(futureRes, 400, 'captured_at 120 s in the future');
    expect(_errorCode(futureRes), 'VALIDATION_ERROR');

    await Future<void>.delayed(const Duration(seconds: 2));
    expect(_isPoint(primary.current, base), isTrue, reason: 'nothing above may move the provider');
    expect(primary.history.length, shown, reason: 'not even a re-notification with a different state');

    // The rate-limited point was NOT stored: the next legitimate write wins and
    // the marker lands on it, never on `tooSoon`.
    pointC2 = _Pt(6.4372, 80.0264, acc: 6.5);
    await postAccepted(order1.deliveryId, pointC2);
    expect(await _until(() => _isPoint(primary.current, pointC2)), isTrue);
    for (final bad in [
      [older.lat, older.lng],
      [ancient.lat, ancient.lng],
      [tooSoon.lat, tooSoon.lng],
      [future.lat, future.lng],
    ]) {
      expect(primary.everShowed(bad[0], bad[1]), isFalse, reason: 'rejected point $bad must never be shown');
    }
    primary.expectMonotonic();
    final stored = await snapshotViaNewWatch(order1.orderId);
    expect(_isPoint(stored, pointC2), isTrue, reason: 'the stored latest is the last ACCEPTED point');
    _obs('S4', 'PASS duplicate -> 202 not_newer; older -> not_newer; 10-min-old -> not_newer; inside 5 s floor -> '
        '202 rate_limited; +120 s future -> 400 VALIDATION_ERROR; provider unchanged through all of them; next '
        'legit write accepted and shown; rejected points never shown; capturedAt monotonic over ${primary.history.length} states');
  }, timeout: scenarioTimeout);

  // ===========================================================================
  test('5. malformed input: 400s, nothing changes', () async {
    await beginScenario();
    final ok = _Pt(6.4380, 80.0270);
    final cases = <String, Map<String, dynamic>>{
      'latitude 91': {...ok.body, 'latitude': 91},
      'longitude -181': {...ok.body, 'longitude': -181},
      'latitude non-numeric': {...ok.body, 'latitude': 'abc'},
      'longitude non-numeric': {...ok.body, 'longitude': 'north'},
      'missing latitude': {...ok.body}..remove('latitude'),
      'missing longitude': {...ok.body}..remove('longitude'),
      'missing accuracy': {...ok.body}..remove('accuracy'),
      'missing captured_at': {...ok.body}..remove('captured_at'),
      'accuracy 0': {...ok.body, 'accuracy': 0},
      'accuracy negative': {...ok.body, 'accuracy': -5},
      'captured_at not a date': {...ok.body, 'captured_at': 'yesterday-ish'},
      'empty body': <String, dynamic>{},
    };
    final before = primary.history.length;
    for (final e in cases.entries) {
      final r = await postRaw(order1.deliveryId, e.value);
      _expectStatus(r, 400, 'malformed: ${e.key}');
      expect(_errorCode(r), 'VALIDATION_ERROR', reason: e.key);
    }
    final badId = await postRaw('not-a-uuid', ok.body);
    _expectStatus(badId, 400, 'non-UUID delivery id');
    final badOrder = await rawStream('not-a-uuid', token: await TokenStorage.getAccessToken());
    _expectRaw(badOrder, 400, 'non-UUID order id on the stream');

    await Future<void>.delayed(const Duration(seconds: 2));
    expect(_isPoint(primary.current, pointC2), isTrue, reason: 'rejected input must not touch the provider');
    expect(primary.history.length, before);
    final stored = await snapshotViaNewWatch(order1.orderId);
    expect(_isPoint(stored, pointC2), isTrue, reason: 'nor the stored point');
    _obs('S5', 'PASS ${cases.length} malformed bodies -> 400 VALIDATION_ERROR (${cases.keys.join('; ')}); '
        'non-UUID delivery id -> 400; non-UUID order id on the stream -> 400; provider and stored point unchanged');
  }, timeout: scenarioTimeout);

  // ===========================================================================
  test('6. authorization matrix with real tokens', () async {
    await beginScenario();
    final customer2 = await backend.otpSignIn(phone2);
    extraCustomers.add({'user_id': customer2.userId, 'phone': phone2});
    writeManifest();

    // A second customer's stream for this order -> 404, provider ends unavailable.
    final other = Dio(BaseOptions(
      baseUrl: _apiBase,
      headers: {'Authorization': 'Bearer ${customer2.access}'},
    ));
    final t2 = track(_counting('S6-customer2', dio: other));
    t2.provider.watch(order1.orderId);
    expect(await _until(() => t2.provider.unavailable, timeout: const Duration(seconds: 12)), isTrue,
        reason: 'another customer\'s order is refused (404): the provider ends unavailable');
    expect(t2.current, isNull);
    expect(t2.provider.closed, isFalse, reason: 'unavailable is not a server close');
    await Future<void>.delayed(const Duration(seconds: 5));
    expect(t2.opens!.n, 1, reason: 'a permanent refusal is not retried');
    expect(t2.current, isNull);
    final raw2 = await rawStream(order1.orderId, token: customer2.access);
    _expectRaw(raw2, 404, 'second customer, raw stream');
    t2.dispose();
    trackers.remove(t2);

    // Unauthenticated / wrong role on the customer stream.
    final noAuth = await rawStream(order1.orderId);
    _expectRaw(noAuth, 401, 'stream without Authorization');
    final asRider = await rawStream(order1.orderId, token: backend.ops[_riderPhone]!.access);
    _expectRaw(asRider, 403, 'RIDER token on the customer stream');
    final asAdmin = await rawStream(order1.orderId, token: backend.ops[_adminPhone]!.access);
    _expectRaw(asAdmin, 403, 'ADMIN token on the customer stream');

    // Wrong role / no auth on the rider location endpoint.
    final probe = _Pt(6.4390, 80.0280);
    final custToken = await TokenStorage.getAccessToken();
    _expectStatus(await postRaw(order1.deliveryId, probe.body, token: custToken, asRider: false), 403,
        'CUSTOMER token on the rider location endpoint');
    _expectStatus(await postRaw(order1.deliveryId, probe.body, token: customer2.access, asRider: false), 403,
        'second customer on the rider location endpoint');
    _expectStatus(await postRaw(order1.deliveryId, probe.body, token: null, asRider: false), 401,
        'no Authorization on the rider location endpoint');
    _expectStatus(await postRaw(order1.deliveryId, probe.body, token: backend.ops[_adminPhone]!.access, asRider: false),
        403, 'ADMIN token on the rider location endpoint');

    await Future<void>.delayed(const Duration(seconds: 2));
    expect(_isPoint(primary.current, pointC2), isTrue, reason: 'none of the refused calls may reach the owner\'s provider');
    final stored = await snapshotViaNewWatch(order1.orderId);
    expect(_isPoint(stored, pointC2), isTrue, reason: 'nor overwrite the stored point');
    _obs('S6', 'PASS customer2 stream -> provider unavailable (closed=false, current=null, exactly 1 connect in 5 s; '
        'raw 404); no Authorization -> 401; RIDER token on stream -> 403; ADMIN token on stream -> 403; CUSTOMER / '
        'customer2 / ADMIN token on rider POST -> 403; no auth on rider POST -> 401; owner\'s provider and stored point untouched');
  }, timeout: scenarioTimeout);

  test(
    '6b. a second rider POSTs to the first rider\'s delivery -> 404, nothing stored',
    () {},
    skip: 'SKIPPED: the dev seed has exactly one rider and there is no API route that creates a rider (riders are '
        'seeded; only GET /admin/riders exists), so no second RIDER account can be signed in through the real '
        'flow. Covered by backend/api/tests/rider-location.test.ts (foreign delivery -> 404 DELIVERY_NOT_FOUND, '
        'no write, no broadcast).',
  );

  // ===========================================================================
  test('7. arrival stops everything: closed within the heartbeat, POST 409, new watch closed', () async {
    await beginScenario();
    final closedBefore = primary.history.length;
    final arrivedAt = Stopwatch()..start();
    await riderStep(order1.deliveryId, 'ARRIVED_AT_CUSTOMER');
    expect(await _until(() => primary.provider.closed, timeout: _heartbeatWait), isTrue,
        reason: 'the customer provider must receive `closed` within the 15 s heartbeat + slack');
    final closeLatency = arrivedAt.elapsedMilliseconds;
    expect(primary.current, isNull);
    expect(primary.provider.freshness, isNull);
    expect(primary.provider.unavailable, isFalse);
    expect(primary.history.length, greaterThan(closedBefore));

    final post = await postPoint(order1.deliveryId, _Pt(6.4400, 80.0290));
    _expectStatus(post, 409, 'rider POST after arrival');
    expect(_errorCode(post), 'DELIVERY_NOT_TRACKABLE');

    final states = primary.history.length;
    await Future<void>.delayed(const Duration(seconds: 6));
    expect(primary.history.length, states, reason: 'the provider must receive nothing further after closed');
    expect(primary.provider.closed, isTrue);
    expect(primary.current, isNull);

    final again = track(_counting('S7-rewatch'));
    again.provider.watch(order1.orderId);
    expect(await _until(() => again.provider.closed, timeout: const Duration(seconds: 12)), isTrue,
        reason: 'a NEW watch after arrival ends closed again: no stale location served');
    expect(again.current, isNull);
    expect(again.history.where((s) => s.lat != null), isEmpty, reason: 'the stored last point must not be served');
    expect(again.opens!.n, 1);
    again.dispose();
    trackers.remove(again);

    // DELIVERED: the same everywhere.
    await collectCod(order1);
    final delivered = await customerCall('GET', '/orders/${order1.orderId}');
    expect(_map(_map(delivered.data)['data']['order'])['order_status'], 'DELIVERED');
    final rawDelivered = await rawStream(order1.orderId, token: await TokenStorage.getAccessToken());
    _expectRaw(rawDelivered, 200, 'raw stream on a delivered order');
    expect(closedReason(rawDelivered.body), 'not_trackable', reason: rawDelivered.body);
    final postDelivered = await postPoint(order1.deliveryId, _Pt(6.4400, 80.0290));
    _expectStatus(postDelivered, 409, 'rider POST after delivery');
    _obs('S7', 'PASS ARRIVED_AT_CUSTOMER -> provider closed after ${closeLatency}ms (heartbeat bound 15 s), '
        'current=null; POST after arrival 409; nothing further received in 6 s; a new watch ended closed with no '
        'point; DELIVERED order: raw stream "closed: not_trackable", POST 409');
  }, timeout: scenarioTimeout);

  // ===========================================================================
  test('8. FAILED -> re-stage -> NEW delivery -> new tracking identity (old point never served)', () async {
    await beginScenario();
    order2 = await stageOrder('order2');
    final oldDelivery = order2.deliveryId;
    await riderStep(oldDelivery, 'PICKED_UP');

    final t = track(_stock('S8'));
    t.provider.watch(order2.orderId);
    await Future<void>.delayed(const Duration(milliseconds: 1500));
    final pointX = _Pt(6.4390, 80.0290, acc: 11.0); // the OLD delivery's point
    await postAccepted(oldDelivery, pointX);
    expect(await _until(() => _isPoint(t.current, pointX)), isTrue, reason: 'the customer sees X live');

    // The rider reports FAILED: the provider ends closed, current cleared.
    final failedAt = Stopwatch()..start();
    await riderStep(oldDelivery, 'FAILED', failureReason: 'Bike broke down; returning the bag');
    expect(await _until(() => t.provider.closed, timeout: _heartbeatWait), isTrue);
    final closeLatency = failedAt.elapsedMilliseconds;
    expect(t.current, isNull);
    final closedIndex = t.history.indexWhere((s) => s.closed);
    expect(closedIndex, greaterThan(-1));
    final oldPost = await postPoint(oldDelivery, _Pt(6.4391, 80.0291));
    _expectStatus(oldPost, 409, 'old delivery POST after FAILED');

    // Admin re-stage: FAILED -> PACKED (RESTAGE, note required), then a NEW delivery.
    final restage = await backend.as(_adminPhone, 'PATCH', '/admin/orders/${order2.orderId}/status',
        data: {'status': 'PACKED', 'notes': 'Bag back at the store; reassigning'});
    _expectStatus(restage, 200, 'PATCH re-stage (FAILED -> PACKED)');
    final newDelivery = await assign(order2.orderId, 'order2 re-assign');
    expect(newDelivery, isNot(oldDelivery), reason: 'a re-stage must create a NEW delivery row');
    order2.deliveryId = newDelivery;
    final packedPost = await postPoint(oldDelivery, _Pt(6.4391, 80.0291));
    _expectStatus(packedPost, 409, 'old delivery POST after re-stage + reassign');
    await riderStep(newDelivery, 'PICKED_UP');
    final seen = await customerCall('GET', '/orders/${order2.orderId}');
    expect(_map(_map(seen.data)['data']['order'])['order_status'], 'OUT_FOR_DELIVERY');

    // The customer watches again. The old delivery's point X must NOT be served.
    t.provider.watch(order2.orderId);
    expect(t.provider.closed, isFalse, reason: 'a new watch resets the closed state');
    expect(t.current, isNull);
    await _holds(
      () => t.current == null && !t.provider.closed && !t.provider.unavailable,
      const Duration(seconds: 4),
      'until the NEW delivery\'s own first POST there must be no location at all (X not served)',
    );
    // ...and the old id is still refused while the new one is live.
    final stillOld = await postPoint(oldDelivery, _Pt(6.4391, 80.0291));
    _expectStatus(stillOld, 409, 'old delivery id after the new one is picked up');
    await Future<void>.delayed(const Duration(seconds: 1));
    expect(t.current, isNull, reason: 'the old-id POST must not have reached the provider');

    // A point 10 minutes old on the new delivery: stored, but not broadcast live.
    final stale = _Pt(6.5000, 80.1000, age: const Duration(minutes: 10));
    await postAccepted(newDelivery, stale); // 202 accepted:true
    await Future<void>.delayed(const Duration(seconds: 2));
    expect(t.current, isNull, reason: 'a point older than 5 minutes is stored but never broadcast live');

    final pointY = _Pt(6.4410, 80.0310, acc: 6.0); // the NEW delivery's point
    await postAccepted(newDelivery, pointY);
    expect(await _until(() => _isPoint(t.current, pointY)), isTrue, reason: 'the customer sees Y, and only Y');

    // X's coordinates never appear after the FAILED close, in any state.
    final afterClose = t.history.skip(closedIndex);
    expect(afterClose.where((s) => s.lat == pointX.lat && s.lng == pointX.lng), isEmpty,
        reason: 'the old delivery\'s point must never reappear: ${t.history}');
    expect(t.everShowed(stale.lat, stale.lng), isFalse);
    t.expectMonotonic();
    final stored = await snapshotViaNewWatch(order2.orderId);
    expect(_isPoint(stored, pointY), isTrue, reason: 'the stored latest for the order is the NEW delivery\'s Y');

    // Tidy: finish the delivery so nothing is left on the road.
    await riderStep(newDelivery, 'ARRIVED_AT_CUSTOMER');
    await collectCod(order2);
    _obs('S8', 'PASS X=$pointX seen live; FAILED -> provider closed after ${closeLatency}ms, current=null; old '
        'delivery POST 409 (also after re-stage+reassign and after the new pickup); re-stage 200; new delivery id '
        '$newDelivery != old $oldDelivery; re-watch: closed reset, current==null for 4 s+ (X not served); a 10-min-old '
        'point on the new delivery -> 202 accepted (stored) but not broadcast; Y=$pointY then shown exactly; X never '
        'shown after the close; fresh watcher snapshot == Y');
  }, timeout: scenarioTimeout);

  // ===========================================================================
  test('9. closed-order matrix: cancelled-after-assignment, cancel refused on the road, customer-unavailable', () async {
    await beginScenario();

    // -- 9a. cancelled after assignment (customer cancels while PACKED + ASSIGNED)
    final order3 = await stageOrder('order3');
    final cancel = await customerCall('POST', '/orders/${order3.orderId}/cancel', data: {'reason': 'Changed my mind'});
    _expectStatus(cancel, 200, 'POST /orders/:id/cancel (PACKED + ASSIGNED)');
    final seen3 = await customerCall('GET', '/orders/${order3.orderId}');
    expect(_map(_map(seen3.data)['data']['order'])['order_status'], 'CANCELLED');
    final raw3 = await rawStream(order3.orderId, token: await TokenStorage.getAccessToken());
    _expectRaw(raw3, 200, 'raw stream, cancelled order');
    expect(closedReason(raw3.body), 'not_trackable', reason: raw3.body);
    final post3 = await postPoint(order3.deliveryId, _Pt(6.4352, 80.0245));
    _expectStatus(post3, 409, 'rider POST on a cancelled order\'s (still ASSIGNED) delivery');
    _obs('S9a', 'PASS cancelled while ASSIGNED: stream "closed: not_trackable", rider POST 409 '
        '(details: ${_map(_map(post3.data)['error'])['details']})');

    // -- 9b. on the road, watched live: a cancel is refused; admin marks the customer unavailable
    final order4 = await stageOrder('order4');
    await riderStep(order4.deliveryId, 'PICKED_UP');
    final t = track(_stock('S9b'));
    t.provider.watch(order4.orderId);
    await Future<void>.delayed(const Duration(milliseconds: 1500));
    final pointZ = _Pt(6.4352, 80.0245, acc: 9.5);
    await postAccepted(order4.deliveryId, pointZ);
    expect(await _until(() => _isPoint(t.current, pointZ)), isTrue);

    final refused = await customerCall('POST', '/orders/${order4.orderId}/cancel', data: {});
    expect(refused.statusCode, inInclusiveRange(400, 499), reason: 'cancel on the road must be refused: ${refused.data}');
    await Future<void>.delayed(const Duration(seconds: 2));
    expect(_isPoint(t.current, pointZ), isTrue, reason: 'a refused cancel must not disturb the stream');
    expect(t.provider.closed, isFalse);

    final markedAt = Stopwatch()..start();
    final mark = await backend.as(_adminPhone, 'PATCH', '/admin/orders/${order4.orderId}/status',
        data: {'status': 'CUSTOMER_UNAVAILABLE', 'notes': 'Customer not at the address; e2e'});
    _expectStatus(mark, 200, 'PATCH CUSTOMER_UNAVAILABLE');
    expect(await _until(() => t.provider.closed, timeout: _heartbeatWait), isTrue,
        reason: 'an open stream closes (delivery_closed) within one heartbeat of the order leaving OUT_FOR_DELIVERY');
    final latency = markedAt.elapsedMilliseconds;
    expect(t.current, isNull);
    final post4 = await postPoint(order4.deliveryId, _Pt(6.4360, 80.0252));
    _expectStatus(post4, 409, 'rider POST after CUSTOMER_UNAVAILABLE');
    final raw4 = await rawStream(order4.orderId, token: await TokenStorage.getAccessToken());
    expect(closedReason(raw4.body), 'not_trackable', reason: raw4.body);
    _obs('S9b', 'PASS on the road: customer cancel refused (${refused.statusCode} ${_errorCode(refused)}), stream '
        'unaffected; admin CUSTOMER_UNAVAILABLE -> live provider closed after ${latency}ms, current=null; POST 409; '
        'new stream "closed: not_trackable"');
    _obs('S9c', 'NOT REACHABLE / not separately run: cancel while OUT_FOR_DELIVERY (the lifecycle catalogue refuses '
        'it for both roles: CUSTOMER_CANCEL and ADMIN_CANCEL start only from PLACED/ITEM_UNAVAILABLE/PACKED, which S9b '
        'confirms with the refused cancel). FAILED and DELIVERED closes are exercised in S8 and S7.');
  }, timeout: scenarioTimeout);

  // ===========================================================================
  test('10. server restart is not terminal: provider keeps its point, then reconnects', () async {
    if (_ctrlDir.isEmpty || !File('$_ctrlDir${Platform.pathSeparator}ready').existsSync()) {
      _obs('S10', 'SKIPPED: E2E_CTRL_DIR not set / backend_ctl.cjs not running, so this test cannot stop and restart the backend.');
      markTestSkipped('needs E2E_CTRL_DIR and backend_ctl.cjs');
      return;
    }
    await beginScenario();
    Future<void> control(String request, String done) async {
      final d = File('$_ctrlDir${Platform.pathSeparator}$done');
      if (d.existsSync()) d.deleteSync();
      File('$_ctrlDir${Platform.pathSeparator}$request').writeAsStringSync('1');
      expect(await _until(d.existsSync, timeout: const Duration(seconds: 100), poll: const Duration(milliseconds: 250)),
          isTrue,
          reason: 'backend_ctl did not answer $request');
      expect(d.readAsStringSync(), '1', reason: '$request failed');
      d.deleteSync();
    }

    final order5 = await stageOrder('order5');
    await riderStep(order5.deliveryId, 'PICKED_UP');
    final t = track(_counting('S10'));
    t.provider.watch(order5.orderId);
    await Future<void>.delayed(const Duration(milliseconds: 1500));
    final p1 = _Pt(6.4352, 80.0245, acc: 10.0);
    await postAccepted(order5.deliveryId, p1);
    expect(await _until(() => _isPoint(t.current, p1)), isTrue);
    expect(t.opens!.n, 1);

    // -- the backend goes away (process tree killed: on Windows there is no
    //    way to deliver SIGTERM, so this is an abrupt drop, not a
    //    `server_shutdown` frame)
    final downAt = Stopwatch()..start();
    await control('stop_request', 'stopped');
    await _holds(() => !t.provider.closed && !t.provider.unavailable && _isPoint(t.current, p1),
        const Duration(seconds: 6), 'a dropped server is not a terminal close: keep the last point');
    expect(await _until(() => t.provider.freshness == LocationFreshness.stale, timeout: const Duration(seconds: 40)),
        isTrue, reason: 'with the server down the retained point must age LIVE -> STALE from time alone');
    final staleAfter = downAt.elapsedMilliseconds;
    expect(t.provider.closed, isFalse);
    expect(t.provider.unavailable, isFalse);
    expect(_isPoint(t.current, p1), isTrue);
    final opensWhileDown = t.opens!.n;
    expect(opensWhileDown, greaterThan(1), reason: 'the provider must be retrying with backoff while the server is down');

    // -- the backend comes back; the rider sends a new point; the provider recovers
    await control('start_request', 'started');
    await backend.refreshOpsIfOld();
    final p2 = _Pt(6.4362, 80.0255, acc: 8.0);
    await postAccepted(order5.deliveryId, p2);
    final backAt = Stopwatch()..start();
    expect(await _until(() => _isPoint(t.current, p2), timeout: const Duration(seconds: 90)), isTrue,
        reason: 'after the restart the provider must reconnect and show the new point; '
            'provider has ${t.current?.latitude},${t.current?.longitude} closed=${t.provider.closed} '
            'unavailable=${t.provider.unavailable} opens=${t.opens!.n}');
    expect(t.provider.closed, isFalse);
    expect(t.provider.unavailable, isFalse);
    expect(t.provider.freshness, LocationFreshness.live);
    t.expectMonotonic();
    expect(t.pointsShown.map((s) => [s.lat, s.lng]).toList(), [
      [p1.lat, p1.lng],
      [p2.lat, p2.lng],
    ]);

    // Live again over the NEW connection: a further point is broadcast.
    final p3 = _Pt(6.4372, 80.0265, acc: 7.0);
    await postAccepted(order5.deliveryId, p3);
    expect(await _until(() => _isPoint(t.current, p3)), isTrue);

    await riderStep(order5.deliveryId, 'ARRIVED_AT_CUSTOMER');
    await collectCod(order5);
    _obs('S10', 'PASS backend killed (taskkill of its process tree; abrupt drop - Windows cannot send SIGTERM so the '
        'graceful `server_shutdown` frame is NOT exercised here, only covered by the provider unit tests): provider '
        'stayed closed=false unavailable=false, kept P1, aged to STALE after ${staleAfter}ms, retried '
        '(${opensWhileDown - 1} failed reconnects while down); backend restarted; P2 posted; provider showed P2 after '
        '${backAt.elapsedMilliseconds}ms with closed=false; P3 then arrived live over the new connection; '
        'history [P1,P2,P3] monotonic; total connects ${t.opens!.n}');
  }, timeout: const Timeout(Duration(minutes: 8)));
}
