import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/profile_screen.dart';
import 'package:ecom/Screens/user_orders_screen.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/app_responsive.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';
import 'fixtures/session_fakes.dart';

const _key = ValueKey('framed');

Widget _framed({double? maxWidth, bool gutter = true}) => ContentFrame(
      maxWidth: maxWidth,
      gutter: gutter,
      child: const SizedBox(key: _key, height: 40, width: double.infinity),
    );

void main() {
  Future<Rect> pumpAt(WidgetTester tester, double width, Widget frame) async {
    await tester.pumpWidget(componentHost(tester, frame, width: width, center: false));
    return tester.getRect(find.byKey(_key));
  }

  testWidgets('compact: full width inside the 16 dp gutter', (tester) async {
    final r = await pumpAt(tester, 400, _framed());
    expect(r.left, BlynkSpace.s16);
    expect(r.width, 400 - 2 * BlynkSpace.s16);
  });

  testWidgets('medium: capped at 840 and centred, gutter 24 when narrower', (tester) async {
    var r = await pumpAt(tester, 800, _framed());
    expect(r.width, 800 - 2 * BlynkSpace.s24);
    expect(r.width, lessThanOrEqualTo(840));

    r = await pumpAt(tester, 1000, _framed());
    expect(r.width, 840);
    expect(r.center.dx, 500);
  });

  testWidgets('expanded: capped at 1200 and centred', (tester) async {
    var r = await pumpAt(tester, 1100, _framed());
    expect(r.width, 1100 - 2 * BlynkSpace.s32);

    r = await pumpAt(tester, 1600, _framed());
    expect(r.width, 1200);
    expect(r.center.dx, 800);
  });

  testWidgets('maxWidth caps a list column at 720 without widening the ladder', (tester) async {
    var r = await pumpAt(tester, 1000, _framed(maxWidth: 720));
    expect(r.width, 720);
    expect(r.center.dx, 500);

    // A cap above the class cap does not raise it.
    r = await pumpAt(tester, 1000, _framed(maxWidth: 2000));
    expect(r.width, 840);

    // Compact is never capped below the screen.
    r = await pumpAt(tester, 400, _framed(maxWidth: 720));
    expect(r.width, 400 - 2 * BlynkSpace.s16);
  });

  testWidgets('gutter: false leaves only the cap and the centring', (tester) async {
    var r = await pumpAt(tester, 400, _framed(gutter: false));
    expect(r.left, 0);
    expect(r.width, 400);

    r = await pumpAt(tester, 1000, _framed(maxWidth: 720, gutter: false));
    expect(r.width, 720);
    expect(r.center.dx, 500);
  });

  testWidgets('measures the available width, not the screen', (tester) async {
    // A 1000 dp screen, but the frame is only given 500 dp, so it behaves as
    // compact (gutter 16, no cap) - the ladder follows the container.
    final r = await pumpAt(
      tester,
      1000,
      Row(
        children: [
          SizedBox(width: 500, child: _framed()),
          const Expanded(child: SizedBox()),
        ],
      ),
    );
    expect(r.left, BlynkSpace.s16);
    expect(r.width, 500 - 2 * BlynkSpace.s16);
  });

  group('the four capped screens', () {
    // Orders list, Profile, Address list and Order detail (plan section 6).
    testWidgets('Profile: rows stop at 720 dp and stay centred on a wide window', (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>.value(
          value: AuthProvider(),
          child: componentHost(tester, const ProfileScreen(), width: 1400, center: false),
        ),
      );
      await tester.pumpAndSettle();
      final frame = tester.widget<ContentFrame>(find.byType(ContentFrame));
      expect(frame.maxWidth, 720);
      final row = tester.getRect(
        find.ancestor(of: find.text('Your orders'), matching: find.byType(InkWell)).first,
      );
      expect(row.width, lessThanOrEqualTo(720));
      expect(row.center.dx, closeTo(700, 1));
    });

    testWidgets('Profile on a phone is unchanged: rows fill the width', (tester) async {
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>.value(
          value: AuthProvider(),
          child: componentHost(tester, const ProfileScreen(), width: 400, center: false),
        ),
      );
      await tester.pumpAndSettle();
      final row = tester.getRect(
        find.ancestor(of: find.text('Your orders'), matching: find.byType(InkWell)).first,
      );
      expect(row.width, 400 - 16);
    });

    testWidgets('Orders: the list column stops at 720 dp on a wide window', (tester) async {
      final orders = OrderProvider(
        request: (method, url, {body, query}) async => {
          'success': true,
          'data': {'orders': [], 'pagination': {'total_pages': 1}},
        },
      );
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: SignedInAuth()),
            ChangeNotifierProvider<OrderProvider>.value(value: orders),
          ],
          child: componentHost(tester, const OrdersScreen(), width: 1400, center: false),
        ),
      );
      await tester.pumpAndSettle();
      final frame = tester.widget<ContentFrame>(find.byType(ContentFrame));
      expect(frame.maxWidth, 720);
      expect(tester.getSize(find.byType(ListView)).width, lessThanOrEqualTo(720));
    });

    test('Address list and Order detail wrap their body in the same frame', () {
      for (final f in ['lib/Screens/user_address_screen.dart', 'lib/Screens/order_summary_screen.dart']) {
        final src = File(f).readAsStringSync();
        expect(src, contains('ContentFrame('), reason: f);
        expect(src, contains('maxWidth: 720'), reason: f);
      }
    });
  });
}
