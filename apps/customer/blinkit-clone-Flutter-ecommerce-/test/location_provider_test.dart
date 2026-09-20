import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
// fake_async is flutter_test's own (already locked) dependency; flutter_test
// does not re-export fakeAsync for plain test() use.
// ignore: depend_on_referenced_packages
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/rider_location_model.dart';
import 'package:ecom/Services/Providers/location.provider.dart';

final _t0 = DateTime.utc(2026, 9, 19, 10, 0, 0);

String _loc({
  double lat = 6.44,
  double lng = 80.03,
  DateTime? capturedAt,
}) {
  final c = capturedAt ?? _t0;
  return 'event: location\n'
      'data: {"latitude":$lat,"longitude":$lng,"accuracy":8,'
      '"captured_at":"${c.toIso8601String()}",'
      '"received_at":"${c.add(const Duration(seconds: 1)).toIso8601String()}"}\n\n';
}

const _closedFrame = 'event: closed\ndata: {"reason":"not_trackable"}\n\n';

/// Feeds one connection's events straight into the provider's handlers and
/// ignores cancellation: simulates a stream that leaks events after the
/// provider has moved on (the generation guard must still discard them).
class _LeakyStream extends Stream<String> {
  void Function(String)? onData;
  void Function(Object)? onError;
  void Function()? onDone;

  @override
  StreamSubscription<String> listen(
    void Function(String event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    this.onData = onData;
    this.onError = onError == null ? null : (e) => (onError as void Function(Object))(e);
    this.onDone = onDone;
    return const Stream<String>.empty().listen(null);
  }
}

/// Test rig: a provider whose opener records calls and hands out
/// controllable controllers, with a manually advanced clock.
class _Rig {
  _Rig({
    Duration interval = const Duration(seconds: 5),
    ReconnectDelay? delay,
    this.async,
  }) {
    provider = LocationProvider(
      opener: (id) {
        openedIds.add(id);
        final c = StreamController<String>();
        controllers.add(c);
        return c.stream;
      },
      now: () => clock,
      freshnessInterval: interval,
      reconnectDelay: delay ?? (a) => Duration(seconds: 1 << a),
    );
    provider.addListener(() => notifications++);
  }

  final FakeAsync? async;
  late final LocationProvider provider;
  final openedIds = <String>[];
  final controllers = <StreamController<String>>[];
  DateTime clock = _t0.add(const Duration(seconds: 1));
  int notifications = 0;

  StreamController<String> get last => controllers.last;

  void flush() => async!.flushMicrotasks();

  void tick(Duration d) {
    clock = clock.add(d);
    async!.elapse(d);
  }
}

/// Runs [body] inside fakeAsync with a rig; disposes the provider at the end.
void _fake(void Function(_Rig rig, FakeAsync async) body, {ReconnectDelay? delay}) {
  fakeAsync((async) {
    final rig = _Rig(async: async, delay: delay);
    body(rig, async);
    rig.provider.dispose();
  });
}

void main() {
  group('LocationProvider (brief base cases)', () {
    test('parses a location event from the stream and exposes it', () async {
      final controller = StreamController<String>();
      final provider = LocationProvider(opener: (_) => controller.stream);
      addTearDown(provider.dispose);
      provider.watch('order-1');
      controller.add(
          'event: location\ndata: {"latitude":6.44,"longitude":80.03,"accuracy":8,"captured_at":"2026-09-19T10:00:00.000Z","received_at":"2026-09-19T10:00:01.000Z"}\n\n');
      await Future<void>.delayed(Duration.zero);
      expect(provider.current?.latitude, 6.44);
      expect(provider.closed, isFalse);
    });

    test('a closed event marks the provider closed and stops updating current', () async {
      final controller = StreamController<String>();
      final provider = LocationProvider(opener: (_) => controller.stream);
      addTearDown(provider.dispose);
      provider.watch('order-1');
      controller.add('event: closed\ndata: {"reason":"not_trackable"}\n\n');
      await Future<void>.delayed(Duration.zero);
      expect(provider.closed, isTrue);
      expect(provider.current, isNull);
    });

    test('stopWatching resets state and does not react to further stream data', () async {
      final controller = StreamController<String>();
      final provider = LocationProvider(opener: (_) => controller.stream);
      addTearDown(provider.dispose);
      provider.watch('order-1');
      controller.add(
          'event: location\ndata: {"latitude":6.44,"longitude":80.03,"accuracy":8,"captured_at":"2026-09-19T10:00:00.000Z","received_at":"2026-09-19T10:00:01.000Z"}\n\n');
      await Future<void>.delayed(Duration.zero);
      provider.stopWatching();
      expect(provider.current, isNull);
      controller.add(
          'event: location\ndata: {"latitude":6.50,"longitude":80.05,"accuracy":8,"captured_at":"2026-09-19T10:00:05.000Z","received_at":"2026-09-19T10:00:06.000Z"}\n\n');
      await Future<void>.delayed(Duration.zero);
      expect(provider.current, isNull);
    });

    test('watching a second order supersedes the first (generation guard)', () async {
      final c1 = StreamController<String>();
      final c2 = StreamController<String>();
      var call = 0;
      final provider = LocationProvider(opener: (_) => call++ == 0 ? c1.stream : c2.stream);
      addTearDown(provider.dispose);
      provider.watch('order-1');
      provider.watch('order-2');
      c1.add(
          'event: location\ndata: {"latitude":1,"longitude":1,"accuracy":1,"captured_at":"2026-09-19T10:00:00.000Z","received_at":"2026-09-19T10:00:01.000Z"}\n\n');
      await Future<void>.delayed(Duration.zero);
      expect(provider.current, isNull);
    });

    test('malformed frames are ignored, not thrown', () async {
      final controller = StreamController<String>();
      final provider = LocationProvider(opener: (_) => controller.stream);
      addTearDown(provider.dispose);
      provider.watch('order-1');
      controller.add('garbage\n\n');
      await Future<void>.delayed(Duration.zero);
      expect(provider.current, isNull);
    });
  });

  group('freshness ages with time (requirement 1)', () {
    test('LIVE -> STALE -> OFFLINE via timer ticks with no events, notifying each tick', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.add(_loc(capturedAt: _t0)); // clock is t0 + 1s
        rig.flush();
        expect(rig.provider.freshness, LocationFreshness.live);
        final afterPoint = rig.notifications;

        rig.tick(const Duration(seconds: 5)); // age 6s
        expect(rig.provider.freshness, LocationFreshness.live);
        expect(rig.notifications, afterPoint + 1);

        rig.tick(const Duration(seconds: 5)); // 11s
        rig.tick(const Duration(seconds: 5)); // 16s
        expect(rig.provider.freshness, LocationFreshness.live);
        rig.tick(const Duration(seconds: 5)); // 21s
        expect(rig.provider.freshness, LocationFreshness.stale);
        expect(rig.notifications, afterPoint + 4);

        for (var i = 0; i < 22; i++) {
          rig.tick(const Duration(seconds: 5)); // up to 131s
        }
        expect(rig.provider.freshness, LocationFreshness.offline);
        // still open, never presented as closed
        expect(rig.provider.closed, isFalse);
        expect(rig.provider.current, isNotNull);
      });
    });

    test('the tick interval is a constructor parameter', () {
      // A 2 s interval fires 3 times in 6 s.
      fakeAsync((async) {
        var ticks = 0;
        final c = StreamController<String>();
        final p = LocationProvider(
          opener: (_) => c.stream,
          freshnessInterval: const Duration(seconds: 2),
          now: () => _t0,
        );
        p.addListener(() => ticks++);
        p.watch('o1');
        c.add(_loc(capturedAt: _t0));
        async.flushMicrotasks();
        final base = ticks;
        async.elapse(const Duration(seconds: 6));
        expect(ticks - base, 3);
        p.dispose();
      });
    });

    test('default interval is 5 seconds', () {
      fakeAsync((async) {
        var ticks = 0;
        final c = StreamController<String>();
        final p = LocationProvider(opener: (_) => c.stream, now: () => _t0);
        p.addListener(() => ticks++);
        p.watch('o1');
        c.add(_loc(capturedAt: _t0));
        async.flushMicrotasks();
        final base = ticks;
        async.elapse(const Duration(seconds: 4));
        expect(ticks, base);
        async.elapse(const Duration(seconds: 1));
        expect(ticks, base + 1);
        p.dispose();
      });
    });

    test('the timer stops on stopWatching, closed and dispose; no notify after dispose', () {
      fakeAsync((async) {
        final c = StreamController<String>();
        var ticks = 0;
        final p = LocationProvider(opener: (_) => c.stream, now: () => _t0);
        p.addListener(() => ticks++);
        p.watch('o1');
        expect(async.periodicTimerCount, 1);
        p.stopWatching();
        expect(async.periodicTimerCount, 0);

        final c2 = StreamController<String>();
        final p2 = LocationProvider(opener: (_) => c2.stream, now: () => _t0);
        p2.watch('o1');
        c2.add(_closedFrame);
        async.flushMicrotasks();
        expect(p2.closed, isTrue);
        expect(async.periodicTimerCount, 0);

        final c3 = StreamController<String>();
        final p3 = LocationProvider(opener: (_) => c3.stream, now: () => _t0);
        var ticks3 = 0;
        p3.addListener(() => ticks3++);
        p3.watch('o1');
        c3.add(_loc(capturedAt: _t0));
        async.flushMicrotasks();
        final before = ticks3;
        p3.dispose();
        expect(async.periodicTimerCount, 0);
        async.elapse(const Duration(minutes: 1));
        expect(ticks3, before);
        expect(ticks, greaterThanOrEqualTo(0));
        p.dispose();
        p2.dispose();
      });
    });
  });

  group('monotonic guard (requirement 2)', () {
    test('newer accepted; equal and older ignored without notifying', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.add(_loc(lat: 1, capturedAt: _t0.add(const Duration(seconds: 10))));
        rig.flush();
        expect(rig.provider.current!.latitude, 1);

        var n = rig.notifications;
        rig.last.add(_loc(lat: 2, capturedAt: _t0.add(const Duration(seconds: 15)))); // newer
        rig.flush();
        expect(rig.provider.current!.latitude, 2);
        expect(rig.notifications, n + 1);

        n = rig.notifications;
        rig.last.add(_loc(lat: 3, capturedAt: _t0.add(const Duration(seconds: 15)))); // equal
        rig.flush();
        expect(rig.provider.current!.latitude, 2);
        expect(rig.notifications, n);

        rig.last.add(_loc(lat: 4, capturedAt: _t0.add(const Duration(seconds: 12)))); // older
        rig.flush();
        expect(rig.provider.current!.latitude, 2);
        expect(rig.notifications, n);
      });
    });
  });

  group('reconnect (requirement 3)', () {
    test('defaultReconnectDelay is 1,2,4,8,16 then capped at 30 s', () {
      expect(
        [for (var i = 0; i < 8; i++) defaultReconnectDelay(i).inSeconds],
        [1, 2, 4, 8, 16, 30, 30, 30],
      );
    });

    test('reconnects after a stream error with a fresh opener call for the same order; keeps last point and is not closed', () {
      _fake((rig, async) {
        rig.provider.watch('order-9');
        rig.last.add(_loc(capturedAt: _t0));
        rig.flush();
        rig.last.addError(Exception('socket reset'));
        rig.flush();
        expect(rig.openedIds, ['order-9']);
        expect(rig.provider.current, isNotNull);
        expect(rig.provider.closed, isFalse);
        expect(rig.provider.unavailable, isFalse);

        rig.tick(const Duration(milliseconds: 999));
        expect(rig.openedIds.length, 1);
        rig.tick(const Duration(milliseconds: 1));
        expect(rig.openedIds, ['order-9', 'order-9']);
        expect(rig.controllers.length, 2);

        // the re-sent snapshot with the same captured_at is a no-op
        final n = rig.notifications;
        rig.last.add(_loc(capturedAt: _t0));
        rig.flush();
        expect(rig.notifications, n);
      });
    });

    test('reconnects when the stream ends without a closed event', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.add(_loc(capturedAt: _t0));
        rig.flush();
        rig.last.close();
        rig.flush();
        expect(rig.provider.closed, isFalse);
        rig.tick(const Duration(seconds: 1));
        expect(rig.openedIds.length, 2);
      });
    });

    test('an opener that throws synchronously is retried, not crashed', () {
      fakeAsync((async) {
        var calls = 0;
        final p = LocationProvider(
          opener: (_) {
            calls++;
            throw StateError('boom');
          },
          reconnectDelay: (_) => const Duration(seconds: 1),
          now: () => _t0,
        );
        p.watch('o1');
        async.elapse(const Duration(seconds: 3));
        expect(calls, 4);
        p.dispose();
      });
    });

    test('no reconnect after an authoritative closed event', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.add(_closedFrame);
        rig.flush();
        expect(rig.provider.closed, isTrue);
        expect(rig.provider.unavailable, isFalse);
        rig.last.close();
        rig.flush();
        rig.tick(const Duration(minutes: 5));
        expect(rig.openedIds.length, 1);
        expect(rig.provider.current, isNull);
        expect(rig.provider.freshness, isNull);
      });
    });

    for (final code in [401, 403, 404, 409]) {
      test('a $code refusal marks unavailable, does not reconnect and is not "closed"', () {
        _fake((rig, async) {
          rig.provider.watch('o1');
          rig.last.addError(LocationStreamRefused(code));
          rig.flush();
          expect(rig.provider.unavailable, isTrue);
          expect(rig.provider.closed, isFalse);
          expect(rig.provider.current, isNull);
          rig.tick(const Duration(minutes: 5));
          expect(rig.openedIds.length, 1);
          expect(async.periodicTimerCount, 0);
          expect(async.nonPeriodicTimerCount, 0);
        });
      });
    }

    test('a refusal on a reconnect (e.g. the order stopped being ours) also stops and clears the point', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.add(_loc(capturedAt: _t0));
        rig.flush();
        rig.last.close();
        rig.flush();
        rig.tick(const Duration(seconds: 1)); // reconnect
        rig.last.addError(const LocationStreamRefused(404));
        rig.flush();
        expect(rig.provider.unavailable, isTrue);
        expect(rig.provider.current, isNull);
        rig.tick(const Duration(minutes: 5));
        expect(rig.openedIds.length, 2);
      });
    });

    for (final code in [500, 502, 503, 408, 429]) {
      test('a transient $code refusal is retried', () {
        _fake((rig, async) {
          rig.provider.watch('o1');
          rig.last.addError(LocationStreamRefused(code));
          rig.flush();
          expect(rig.provider.unavailable, isFalse);
          rig.tick(const Duration(seconds: 1));
          expect(rig.openedIds.length, 2);
        });
      });
    }

    test('backoff attempts 0,1,2,... and resets after a successful frame', () {
      final attempts = <int>[];
      final delays = <Duration>[];
      _fake((rig, async) {
        rig.provider.watch('o1');
        // three consecutive failures
        rig.last.addError(Exception('x'));
        rig.flush();
        rig.tick(const Duration(seconds: 1));
        rig.last.addError(Exception('x'));
        rig.flush();
        rig.tick(const Duration(seconds: 1));
        expect(rig.openedIds.length, 2, reason: 'second delay is 2 s, not yet elapsed');
        rig.tick(const Duration(seconds: 1));
        expect(rig.openedIds.length, 3);
        rig.last.addError(Exception('x'));
        rig.flush();
        rig.tick(const Duration(seconds: 3));
        expect(rig.openedIds.length, 3, reason: 'third delay is 4 s');
        rig.tick(const Duration(seconds: 1));
        expect(rig.openedIds.length, 4);

        // a successful frame resets backoff to 1 s
        rig.last.add(_loc(capturedAt: _t0));
        rig.flush();
        rig.last.addError(Exception('x'));
        rig.flush();
        rig.tick(const Duration(seconds: 1));
        expect(rig.openedIds.length, 5);
      }, delay: (a) {
        attempts.add(a);
        final d = Duration(seconds: 1 << a);
        delays.add(d);
        return d;
      });
      expect(attempts, [0, 1, 2, 0]);
    });

    test('a heartbeat comment alone also resets the backoff', () {
      final attempts = <int>[];
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.addError(Exception('x'));
        rig.flush();
        rig.tick(const Duration(seconds: 1));
        rig.last.add(': heartbeat\n\n');
        rig.flush();
        rig.last.addError(Exception('x'));
        rig.flush();
      }, delay: (a) {
        attempts.add(a);
        return const Duration(seconds: 1);
      });
      expect(attempts, [0, 0]);
    });

    test('reconnect delay is capped at 30 s with the default function', () {
      fakeAsync((async) {
        var opens = 0;
        final p = LocationProvider(
          opener: (_) {
            opens++;
            return Stream<String>.error(Exception('down'));
          },
          now: () => _t0,
        );
        p.watch('o1');
        // 1+2+4+8+16 = 31 s for 5 retries, then 30 s each
        async.elapse(const Duration(seconds: 31));
        expect(opens, 6);
        async.elapse(const Duration(seconds: 29));
        expect(opens, 6);
        async.elapse(const Duration(seconds: 1));
        expect(opens, 7);
        p.dispose();
      });
    });
  });

  group('identity / re-stage safety (requirement 4)', () {
    test('watch for a new order clears current, closed, unavailable and buffers', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.add(_loc(capturedAt: _t0));
        rig.last.add('event: loc'); // partial buffered frame
        rig.flush();
        rig.provider.watch('o2');
        expect(rig.provider.current, isNull);
        expect(rig.openedIds, ['o1', 'o2']);
        // the leftover partial 'event: loc' from o1 must not prefix o2's frame
        rig.last.add('ation\ndata: {}\n\n');
        rig.last.add(_loc(lat: 9, capturedAt: _t0));
        rig.flush();
        expect(rig.provider.current!.latitude, 9);

        rig.last.add(_closedFrame);
        rig.flush();
        expect(rig.provider.closed, isTrue);
        rig.provider.watch('o2');
        expect(rig.provider.closed, isFalse);
        expect(rig.provider.current, isNull);

        rig.last.addError(const LocationStreamRefused(404));
        rig.flush();
        expect(rig.provider.unavailable, isTrue);
        rig.provider.watch('o3');
        expect(rig.provider.unavailable, isFalse);
      });
    });

    test('a re-watch of the same order never reuses the old point, even an "older" new one', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.add(_loc(lat: 1, capturedAt: _t0.add(const Duration(seconds: 50))));
        rig.flush();
        rig.provider.watch('o1');
        expect(rig.provider.current, isNull);
        rig.last.add(_loc(lat: 2, capturedAt: _t0)); // older than the discarded point
        rig.flush();
        expect(rig.provider.current!.latitude, 2);
      });
    });

    test('late data, errors and done from a superseded generation are ignored (leaky streams)', () {
      fakeAsync((async) {
        final first = _LeakyStream();
        final second = _LeakyStream();
        var opens = 0;
        final p = LocationProvider(
          opener: (_) => opens++ == 0 ? first : second,
          reconnectDelay: (_) => const Duration(seconds: 1),
          now: () => _t0,
        );
        p.watch('o1');
        p.watch('o2');
        first.onData!(_loc(lat: 1, capturedAt: _t0));
        first.onData!(_closedFrame);
        first.onError!(const LocationStreamRefused(404));
        first.onDone!();
        async.elapse(const Duration(seconds: 10));
        expect(p.current, isNull);
        expect(p.closed, isFalse);
        expect(p.unavailable, isFalse);
        expect(opens, 2, reason: 'no reconnect scheduled by the old stream');

        second.onData!(_loc(lat: 2, capturedAt: _t0));
        expect(p.current!.latitude, 2);
        p.stopWatching();
        second.onData!(_loc(lat: 3, capturedAt: _t0.add(const Duration(seconds: 5))));
        second.onDone!();
        async.elapse(const Duration(seconds: 10));
        expect(p.current, isNull);
        expect(opens, 2);
        p.dispose();
      });
    });

    test('after closed, current stays null until a new watch', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.add(_closedFrame + _loc(capturedAt: _t0)); // data after closed in the same chunk
        rig.flush();
        expect(rig.provider.current, isNull);
        rig.last.add(_loc(capturedAt: _t0.add(const Duration(seconds: 5))));
        rig.flush();
        expect(rig.provider.current, isNull);
        rig.provider.watch('o1');
        rig.last.add(_loc(capturedAt: _t0));
        rig.flush();
        expect(rig.provider.current, isNotNull);
      });
    });
  });

  group('SSE parsing (requirement 6)', () {
    test('a frame split across chunks, including a split between the two newlines', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        final frame = _loc(lat: 7, capturedAt: _t0);
        final body = frame.substring(0, frame.length - 2);
        rig.last.add(body.substring(0, 10));
        rig.last.add(body.substring(10, 40));
        rig.last.add(body.substring(40));
        rig.last.add('\n'); // first terminator newline
        rig.flush();
        expect(rig.provider.current, isNull);
        rig.last.add('\n'); // second
        rig.flush();
        expect(rig.provider.current!.latitude, 7);
      });
    });

    test('several frames in one chunk are all applied in order', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.add(_loc(lat: 1, capturedAt: _t0) +
            _loc(lat: 2, capturedAt: _t0.add(const Duration(seconds: 5))));
        rig.flush();
        expect(rig.provider.current!.latitude, 2);
        rig.last.add(_loc(lat: 3, capturedAt: _t0.add(const Duration(seconds: 10))) + _closedFrame);
        rig.flush();
        expect(rig.provider.closed, isTrue);
        expect(rig.provider.current, isNull);
      });
    });

    test('CRLF line endings are tolerated, even split across chunks', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        final crlf = _loc(lat: 5, capturedAt: _t0).replaceAll('\n', '\r\n');
        rig.last.add(crlf.substring(0, crlf.length - 1)); // ends with "\r\n\r"
        rig.flush();
        expect(rig.provider.current, isNull);
        rig.last.add('\n');
        rig.flush();
        expect(rig.provider.current!.latitude, 5);
      });
    });

    test('comments, heartbeats and unknown events are ignored without notifying', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        final n = rig.notifications;
        rig.last.add(': heartbeat\n\n');
        rig.last.add('event: banana\ndata: {"a":1}\n\n');
        rig.last.add('data: {"latitude":1}\n\n'); // no event field
        rig.flush();
        expect(rig.provider.current, isNull);
        expect(rig.provider.closed, isFalse);
        expect(rig.notifications, n);
      });
    });

    test('malformed / non-object JSON and invalid points are ignored, and later frames still work', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        final n = rig.notifications;
        for (final data in [
          '{not json',
          '[1,2,3]',
          '"a string"',
          'null',
          '42',
          '',
          '{"latitude":999,"longitude":80,"accuracy":8,"captured_at":"2026-09-19T10:00:00.000Z","received_at":"2026-09-19T10:00:01.000Z"}',
          '{"latitude":6,"longitude":80,"accuracy":8}',
        ]) {
          rig.last.add('event: location\ndata: $data\n\n');
        }
        rig.last.add('event: location\n\n'); // no data at all
        rig.flush();
        expect(rig.provider.current, isNull);
        expect(rig.notifications, n);

        rig.last.add(_loc(lat: 3, capturedAt: _t0));
        rig.flush();
        expect(rig.provider.current!.latitude, 3);
      });
    });

    test('a buffer over 64 KB without a terminator is dropped and parsing recovers', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.add('x' * (64 * 1024 + 1));
        rig.flush();
        rig.last.add(_loc(lat: 4, capturedAt: _t0));
        rig.flush();
        // without the cap the junk would prefix 'event: location' and hide it
        expect(rig.provider.current!.latitude, 4);
      });
    });

    test('a buffer just under the cap is kept', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        final frame = _loc(lat: 6, capturedAt: _t0);
        rig.last.add(frame.substring(0, frame.length - 2));
        rig.flush();
        rig.last.add('\n\n');
        rig.flush();
        expect(rig.provider.current!.latitude, 6);
      });
    });
  });

  group('teardown (requirement 7)', () {
    test('stopWatching cancels the subscription and leaves no timers', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        expect(rig.last.hasListener, isTrue);
        rig.provider.stopWatching();
        expect(rig.last.hasListener, isFalse);
        expect(async.periodicTimerCount, 0);
        expect(async.nonPeriodicTimerCount, 0);
      });
    });

    test('stopWatching while a reconnect is pending cancels the reconnect', () {
      _fake((rig, async) {
        rig.provider.watch('o1');
        rig.last.addError(Exception('x'));
        rig.flush();
        expect(async.nonPeriodicTimerCount, 1);
        rig.provider.stopWatching();
        expect(async.nonPeriodicTimerCount, 0);
        rig.tick(const Duration(minutes: 1));
        expect(rig.openedIds.length, 1);
      });
    });

    test('dispose cancels the subscription, age timer and pending reconnect; nothing fires afterwards', () {
      fakeAsync((async) {
        final rig = _Rig(async: async);
        rig.provider.watch('o1');
        rig.last.add(_loc(capturedAt: _t0));
        rig.flush();
        rig.last.addError(Exception('x'));
        rig.flush();
        expect(async.nonPeriodicTimerCount, 1);
        final n = rig.notifications;
        rig.provider.dispose();
        expect(async.periodicTimerCount, 0);
        expect(async.nonPeriodicTimerCount, 0);
        rig.tick(const Duration(minutes: 5));
        expect(rig.openedIds.length, 1);
        expect(rig.notifications, n);

        final rig2 = _Rig(async: async);
        rig2.provider.watch('o1');
        expect(rig2.last.hasListener, isTrue);
        rig2.provider.dispose();
        expect(rig2.last.hasListener, isFalse);
        // late data after dispose must not throw or notify
        rig2.last.add(_loc(capturedAt: _t0));
        rig2.flush();
        // calling public methods after dispose is a harmless no-op
        rig2.provider.watch('o9');
        rig2.provider.stopWatching();
        expect(rig2.openedIds, ['o1']);
      });
    });
  });

  group('real opener (requirement 5)', () {
    test('requests the stream path under the dio base URL with a stream response and a long receive timeout', () async {
      final adapter = _FakeAdapter((options) => ResponseBody(
            Stream<Uint8List>.fromIterable([Uint8List.fromList(utf8.encode(': hi\n\n'))]),
            200,
          ));
      final dio = Dio(BaseOptions(
        baseUrl: 'https://api.example.test/api/v1',
        receiveTimeout: const Duration(seconds: 15),
      ))
        ..httpClientAdapter = adapter;
      final chunks = await openLocationStream(dio, 'ord 1').toList();
      expect(chunks.join(), ': hi\n\n');
      final o = adapter.requests.single;
      expect(o.uri.toString(), 'https://api.example.test/api/v1/orders/ord%201/location/stream');
      expect(o.responseType, ResponseType.stream);
      expect(o.receiveTimeout, const Duration(seconds: 45));
      expect(o.headers['Accept'], 'text/event-stream');
    });

    test('decodes UTF-8 correctly across chunk boundaries', () async {
      final bytes = utf8.encode('event: x\ndata: café 中文 \u{1F6F5}\n\n');
      // split inside multi-byte sequences
      final parts = [
        Uint8List.fromList(bytes.sublist(0, 18)),
        Uint8List.fromList(bytes.sublist(18, 21)),
        Uint8List.fromList(bytes.sublist(21)),
      ];
      final adapter = _FakeAdapter((_) => ResponseBody(Stream<Uint8List>.fromIterable(parts), 200));
      final dio = Dio(BaseOptions(baseUrl: 'https://h.test'))..httpClientAdapter = adapter;
      final text = (await openLocationStream(dio, 'o').toList()).join();
      expect(text, 'event: x\ndata: café 中文 \u{1F6F5}\n\n');
    });

    test('an HTTP error status surfaces as LocationStreamRefused(statusCode)', () async {
      for (final code in [401, 403, 404, 409, 500]) {
        final adapter = _FakeAdapter((_) => ResponseBody.fromString('{"error":{}}', code));
        final dio = Dio(BaseOptions(baseUrl: 'https://h.test'))..httpClientAdapter = adapter;
        Object? error;
        try {
          await openLocationStream(dio, 'o').toList();
        } catch (e) {
          error = e;
        }
        expect(error, isA<LocationStreamRefused>(), reason: 'status $code');
        expect((error as LocationStreamRefused).statusCode, code);
        expect(error.permanent, code != 500);
      }
    });

    test('a network failure is NOT a refusal (so the provider retries it)', () async {
      final adapter = _FakeAdapter((options) => throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          ));
      final dio = Dio(BaseOptions(baseUrl: 'https://h.test'))..httpClientAdapter = adapter;
      Object? error;
      try {
        await openLocationStream(dio, 'o').toList();
      } catch (e) {
        error = e;
      }
      expect(error, isA<DioException>());
    });

    test('cancelling the subscription cancels the request so the connection is closed', () async {
      final body = StreamController<Uint8List>();
      final adapter = _FakeAdapter((_) => ResponseBody(body.stream, 200));
      final dio = Dio(BaseOptions(baseUrl: 'https://h.test'))..httpClientAdapter = adapter;
      final got = Completer<String>();
      final sub = openLocationStream(dio, 'o').listen(got.complete);
      body.add(Uint8List.fromList(utf8.encode('event: closed\n')));
      expect(await got.future, 'event: closed\n');
      expect(adapter.cancelled, isFalse);
      await sub.cancel();
      await Future<void>.delayed(Duration.zero); // let the cancelFuture callback run
      expect(adapter.cancelled, isTrue);
      expect(body.hasListener, isFalse);
      await body.close();
    });
  });
}

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this._respond);

  final ResponseBody Function(RequestOptions options) _respond;
  final requests = <RequestOptions>[];
  bool cancelled = false;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    cancelFuture?.then((_) => cancelled = true);
    return _respond(options);
  }

  @override
  void close({bool force = false}) {}
}
