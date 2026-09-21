import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Screens/Auth/login_screen.dart';
import 'package:ecom/Screens/customer_shell.dart';
import 'package:ecom/Screens/not_found_screen.dart';
import 'package:ecom/Screens/session_gate.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/route_generator.dart';

List<String> _routes() {
  final source = File('lib/route_generator.dart').readAsStringSync();
  return RegExp(r'''case\s+['"]([^'"]+)['"]\s*:''').allMatches(source).map((m) => m.group(1)!).toList();
}

String _norm(String path) => path.replaceAll(r'\', '/');

Iterable<File> _libFiles() => Directory('lib')
    .listSync(recursive: true)
    .whereType<File>()
    .where((f) => f.path.endsWith('.dart'));

Future<Widget> _build(WidgetTester tester, String name, {Object? arguments}) async {
  late Widget built;
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) {
          final route = AppRouter.generateRoute(RouteSettings(name: name, arguments: arguments))!;
          built = (route as MaterialPageRoute).builder(context);
          return const SizedBox();
        },
      ),
    ),
  );
  return built;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // A widget test can end with a storage call unfinished; do not let it block the next test.
  setUp(() {
    TokenStorage.resetSerialQueueForTest();
    FlutterSecureStorage.setMockInitialValues({});
  });
  tearDown(TokenStorage.resetSerialQueueForTest);

  group('routes', () {
    test('the tab-only routes are gone', () {
      final routes = _routes();
      for (final gone in ['/orders', '/profile', '/help']) {
        expect(routes, isNot(contains(gone)), reason: gone);
      }
    });

    test('order detail, login and the shell are still routes', () {
      expect(_routes(), containsAll(['/', '/login', '/home', '/order', '/order/confirm', '/user/address']));
    });

    testWidgets('the removed paths now fall through to the not-found screen', (tester) async {
      for (final gone in ['/orders', '/profile', '/help']) {
        expect(await _build(tester, gone), isA<NotFoundScreen>(), reason: gone);
      }
    });

    testWidgets('"/" is the session gate and "/login" is the login screen', (tester) async {
      expect(await _build(tester, '/'), isA<SessionGate>());
      expect(await _build(tester, '/login'), isA<LoginScreen>());
    });

    testWidgets('"/home" opens the Shop tab, or the tab given as its argument', (tester) async {
      expect((await _build(tester, '/home')) as CustomerShell, isA<CustomerShell>().having((s) => s.initialTab, 'tab', 0));
      final onOrders = await _build(tester, '/home', arguments: 1);
      expect((onOrders as CustomerShell).initialTab, 1);
      final junk = await _build(tester, '/home', arguments: 'nonsense');
      expect((junk as CustomerShell).initialTab, 0);
    });
  });

  group('callers', () {
    test('nothing pushes /orders, /profile or /help by name', () {
      final pushes = RegExp(
        r'''(pushNamed|pushReplacementNamed|pushNamedAndRemoveUntil|popAndPushNamed)\s*(<[^>(]*>)?\(\s*(?:[A-Za-z_.]+\s*,\s*)?['"](/orders|/profile|/help)['"]''',
      );
      final offenders = _libFiles().where((f) => pushes.hasMatch(f.readAsStringSync())).map((f) => _norm(f.path));
      expect(offenders, isEmpty);
    });

    test('Profile "Your orders" and the Home person button select tabs', () {
      final profile = File('lib/Screens/profile_screen.dart').readAsStringSync();
      final appBar = File('lib/UI/Widgets/Organisms/home_screen_app_bar.dart').readAsStringSync();
      expect(profile, contains('CustomerShell.selectTab(context, 1)'));
      expect(appBar, contains('CustomerShell.selectTab(context, 3)'));
    });

    test('the route-caller allow-list is empty (every route has a caller)', () {
      final source = File('test/route_callers_test.dart').readAsStringSync();
      expect(source, contains('const _allowedWithoutCaller = <String, String>{};'));
    });
  });

  group('CustomerShell.selectTab', () {
    const stubTabs = <Widget>[
      Center(child: Text('shop tab')),
      Center(child: Text('orders tab')),
      Center(child: Text('help tab')),
      Center(child: Text('profile tab')),
    ];

    Widget app() => MultiProvider(
          providers: [
            ChangeNotifierProvider(create: (_) => ProductProvider(request: (u, q) async => {})),
            ChangeNotifierProvider(create: (_) => CartProvider()),
            ChangeNotifierProvider(create: (_) => AddressProvider(request: ({methodType, url, body}) async => {})),
            ChangeNotifierProvider(create: (_) => AuthProvider()),
            ChangeNotifierProvider(create: (_) => OrderProvider(request: (m, u, {body, query}) async => {})),
          ],
          child: MaterialApp(
            theme: AppTheme.theme,
            onGenerateRoute: (settings) {
              if (settings.name == '/detail') {
                return MaterialPageRoute(
                  settings: settings,
                  builder: (context) => Scaffold(
                    body: Column(
                      children: [
                        const Text('detail page'),
                        TextButton(
                          onPressed: () => CustomerShell.selectTab(context, 2),
                          child: const Text('go to help'),
                        ),
                        TextButton(
                          onPressed: () => CustomerShell.openShop(context),
                          child: const Text('go to shop'),
                        ),
                      ],
                    ),
                  ),
                );
              }
              return MaterialPageRoute(
                settings: const RouteSettings(name: '/home'),
                builder: (_) => CustomerShell(
                  initialTab: settings.arguments is int ? settings.arguments! as int : 0,
                  tabs: stubTabs,
                ),
              );
            },
          ),
        );

    Future<void> pumpShell(WidgetTester tester) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(app());
      await tester.pump(const Duration(milliseconds: 300));
    }

    Future<void> pushDetail(WidgetTester tester) async {
      tester.state<NavigatorState>(find.byType(Navigator)).pushNamed('/detail');
      await tester.pumpAndSettle();
    }

    testWidgets('from a pushed page it closes the page and shows the requested tab', (tester) async {
      await pumpShell(tester);
      await pushDetail(tester);
      expect(find.text('detail page'), findsOneWidget);

      await tester.tap(find.text('go to help'));
      await tester.pumpAndSettle();

      expect(find.text('detail page'), findsNothing);
      // The tab is selected (an IndexedStack keeps the others mounted but
      // hidden, so check what is visible).
      expect(find.text('help tab').hitTestable(), findsOneWidget);
      expect(find.text('shop tab').hitTestable(), findsNothing);
      expect(tester.state<NavigatorState>(find.byType(Navigator)).canPop(), isFalse);
    });

    testWidgets('it does not stack a second shell', (tester) async {
      await pumpShell(tester);
      await pushDetail(tester);

      await tester.tap(find.text('go to help'));
      await tester.pumpAndSettle();

      expect(find.byType(CustomerShell), findsOneWidget);
    });

    testWidgets('openShop is still the same call with index 0', (tester) async {
      await pumpShell(tester);
      await tester.tap(find.text('Help'));
      await tester.pumpAndSettle();
      expect(find.text('help tab').hitTestable(), findsOneWidget);
      await pushDetail(tester);

      await tester.tap(find.text('go to shop'));
      await tester.pumpAndSettle();

      expect(find.text('shop tab').hitTestable(), findsOneWidget);
      expect(find.text('detail page'), findsNothing);
    });

    testWidgets('on the shell itself it just switches tab', (tester) async {
      await pumpShell(tester);
      late BuildContext shellContext;
      shellContext = tester.element(find.byType(CustomerShell));

      CustomerShell.selectTab(shellContext, 1);
      await tester.pumpAndSettle();

      expect(find.text('orders tab').hitTestable(), findsOneWidget);
      expect(find.byType(CustomerShell), findsOneWidget);
    });
  });
}
