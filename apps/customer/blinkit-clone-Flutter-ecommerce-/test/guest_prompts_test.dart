import 'dart:ui' show SemanticsAction;

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Screens/customer_shell.dart';
import 'package:ecom/Screens/profile_screen.dart';
import 'package:ecom/Screens/user_orders_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_app_bar.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/session_fakes.dart';

/// Counts `loadOrders` calls without touching the network.
class _CountingOrders extends OrderProvider {
  int loads = 0;

  @override
  Future<void> loadOrders() async {
    loads++;
  }
}

/// An auth whose signed-in state a test can flip.
class _SwitchAuth extends AuthProvider {
  bool signedIn = false;

  @override
  bool get isAuthenticated => signedIn;

  void setSignedIn(bool value) {
    signedIn = value;
    notifyListeners();
  }
}

class _RouteLog {
  final names = <String>[];
  final arguments = <Object?>[];

  Route<dynamic> generate(RouteSettings settings) {
    names.add(settings.name ?? '');
    arguments.add(settings.arguments);
    return MaterialPageRoute(settings: settings, builder: (_) => const Scaffold(body: Text('pushed page')));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // A widget test can end with a storage call unfinished; do not let it block the next test.
  setUp(() {
    TokenStorage.resetSerialQueueForTest();
    FlutterSecureStorage.setMockInitialValues({});
  });
  tearDown(TokenStorage.resetSerialQueueForTest);

  group('Orders tab', () {
    Future<void> pumpOrders(
      WidgetTester tester,
      AuthProvider auth,
      OrderProvider orders,
      _RouteLog log, {
      double textScale = 1,
    }) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: auth),
            ChangeNotifierProvider<OrderProvider>.value(value: orders),
          ],
          child: MaterialApp(
            theme: AppTheme.theme,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
              child: child!,
            ),
            home: const OrdersScreen(),
            onGenerateRoute: log.generate,
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
    }

    testWidgets('a guest sees a log-in prompt and no request is made', (tester) async {
      final orders = _CountingOrders();
      await pumpOrders(tester, AuthProvider(), orders, _RouteLog());

      expect(find.text('Log in to see your orders'), findsOneWidget);
      expect(find.widgetWithText(BlynkButton, 'Log in'), findsOneWidget);
      expect(orders.loads, 0);
      // Never the raw error state a 401 used to produce.
      expect(find.text("Couldn't load your orders."), findsNothing);
      expect(find.text('Try again'), findsNothing);
      expect(find.text("You haven't placed any orders yet."), findsNothing);
    });

    testWidgets('coming back to the foreground does not fetch for a guest either', (tester) async {
      final orders = _CountingOrders();
      await pumpOrders(tester, AuthProvider(), orders, _RouteLog());

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();

      expect(orders.loads, 0);
    });

    testWidgets('"Log in" opens /login', (tester) async {
      final log = _RouteLog();
      await pumpOrders(tester, AuthProvider(), _CountingOrders(), log);

      await tester.tap(find.widgetWithText(BlynkButton, 'Log in'));
      await tester.pumpAndSettle();

      expect(log.names.last, '/login');
    });

    testWidgets('the prompt is a primary 48 dp button and does not overflow at 2.0x', (tester) async {
      await pumpOrders(tester, AuthProvider(), _CountingOrders(), _RouteLog(), textScale: 2);

      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.widgetWithText(BlynkButton, 'Log in')).height, greaterThanOrEqualTo(48));
      expect(find.descendant(of: find.widgetWithText(BlynkButton, 'Log in'), matching: find.byType(ElevatedButton)),
          findsOneWidget);
    });

    testWidgets('a signed-in customer gets today\'s behaviour: the list loads once', (tester) async {
      final orders = _CountingOrders();
      await pumpOrders(tester, SignedInAuth(), orders, _RouteLog());

      expect(orders.loads, 1);
      expect(find.text('Log in to see your orders'), findsNothing);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(orders.loads, 2);
    });

    testWidgets('logging in while the tab is showing loads the orders', (tester) async {
      final auth = _SwitchAuth();
      final orders = _CountingOrders();
      await pumpOrders(tester, auth, orders, _RouteLog());
      expect(orders.loads, 0);

      auth.setSignedIn(true);
      await tester.pump();
      await tester.pump();

      expect(orders.loads, 1);
      expect(find.text('Log in to see your orders'), findsNothing);
    });

    testWidgets('mounting the shell as a guest makes no orders request', (tester) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final orders = _CountingOrders();
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: AuthProvider()),
            ChangeNotifierProvider<OrderProvider>.value(value: orders),
            ChangeNotifierProvider(create: (_) => CartProvider()),
            ChangeNotifierProvider(create: (_) => ProductProvider(request: (u, q) async => {})),
          ],
          child: MaterialApp(
            theme: AppTheme.theme,
            home: const CustomerShell(tabs: [SizedBox(), OrdersScreen(), SizedBox(), SizedBox()]),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      // IndexedStack builds the Orders tab at mount, so this was a 401 before.
      expect(orders.loads, 0);
    });
  });

  group('Home location row', () {
    Future<_RouteLog> pumpHomeBar(WidgetTester tester, AuthProvider auth, {double textScale = 1, double width = 400}) async {
      final log = _RouteLog();
      tester.view.physicalSize = Size(width, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: auth),
            ChangeNotifierProvider(create: (_) => AddressProvider(request: ({methodType, url, body}) async => {})),
          ],
          child: MaterialApp(
            theme: AppTheme.theme,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
              child: child!,
            ),
            home: const Scaffold(body: CustomScrollView(slivers: [HomeScreenAppBar()])),
            onGenerateRoute: log.generate,
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      return log;
    }

    testWidgets("a guest's log-in prompt is a tap target for /login", (tester) async {
      final log = await pumpHomeBar(tester, AuthProvider());

      // 2026-09-24: the address block got its own row with real vertical
      // space (the reference composition), so the destination line carries
      // the whole sentence again rather than a clipped 'Log in' link beside
      // a caption. Same target, same route, same spoken label.
      final prompt = find.text('Log in to set your delivery address');
      expect(prompt, findsOneWidget);
      final target = find.ancestor(of: prompt, matching: find.byType(InkWell)).first;
      final size = tester.getSize(target);
      expect(size.height, greaterThanOrEqualTo(48));
      expect(size.width, greaterThanOrEqualTo(48));

      await tester.tap(prompt);
      await tester.pumpAndSettle();
      expect(log.names.last, '/login');
    });

    testWidgets('the guest row has button semantics with a tap action', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpHomeBar(tester, AuthProvider());

      final node = tester.getSemantics(find.text('Log in to set your delivery address'));
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
      expect(node.label, contains('Log in to set your delivery address'));
      handle.dispose();
    });

    testWidgets('the guest row grows instead of overflowing at 2.0x', (tester) async {
      await pumpHomeBar(tester, AuthProvider(), textScale: 2, width: 320);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a signed-in customer\'s row still opens the address book', (tester) async {
      final log = await pumpHomeBar(tester, SignedInAuth());

      expect(find.text('Log in to set your delivery address'), findsNothing);
      await tester.tap(find.text('Add a delivery address'));
      await tester.pumpAndSettle();
      expect(log.names.last, '/user/address');
    });

    testWidgets('the person button selects the Profile tab instead of pushing /profile', (tester) async {
      final log = await pumpHomeBar(tester, AuthProvider());

      await tester.tap(find.byTooltip('Profile'));
      await tester.pumpAndSettle();

      // No shell underneath in this harness: one is started on tab 3.
      expect(log.names.last, '/home');
      expect(log.arguments.last, 3);
      expect(log.names, isNot(contains('/profile')));
    });
  });

  group('Profile as a guest', () {
    Future<_RouteLog> pumpProfile(WidgetTester tester, AuthProvider auth, {double textScale = 1}) async {
      final log = _RouteLog();
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>.value(
          value: auth,
          child: MaterialApp(
            theme: AppTheme.theme,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
              child: child!,
            ),
            home: const ProfileScreen(),
            onGenerateRoute: log.generate,
          ),
        ),
      );
      await tester.pumpAndSettle();
      return log;
    }

    testWidgets('keeps "My Account", adds a primary Log in above the rows, hides Log out', (tester) async {
      final log = await pumpProfile(tester, AuthProvider());

      expect(find.text('My Account'), findsOneWidget);
      final button = find.widgetWithText(BlynkButton, 'Log in');
      expect(button, findsOneWidget);
      expect(find.text('Log out'), findsNothing);
      expect(tester.getTopLeft(button).dy, lessThan(tester.getTopLeft(find.text('Your orders')).dy));
      expect(tester.getSize(button).height, greaterThanOrEqualTo(48));

      await tester.tap(button);
      await tester.pumpAndSettle();
      expect(log.names.last, '/login');
    });

    testWidgets('does not overflow at 2.0x with the Log in button', (tester) async {
      await pumpProfile(tester, AuthProvider(), textScale: 2);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a signed-in customer has Log out and no Log in button', (tester) async {
      await pumpProfile(tester, SignedInAuth());

      expect(find.text('Log out'), findsOneWidget);
      expect(find.widgetWithText(BlynkButton, 'Log in'), findsNothing);
    });

    testWidgets('logging out flips the screen to the guest view in place', (tester) async {
      FlutterSecureStorage.setMockInitialValues({'blynk_refresh_token': 'r'});
      final auth = AuthProvider(request: ({methodType, url, body}) async => {'success': true});
      await auth.restoreSession();
      await pumpProfile(tester, auth);
      expect(find.text('Log out'), findsOneWidget);

      await tester.runAsync(auth.logout);
      await tester.pumpAndSettle();

      expect(find.text('Log out'), findsNothing);
      expect(find.widgetWithText(BlynkButton, 'Log in'), findsOneWidget);
    });
  });
}
