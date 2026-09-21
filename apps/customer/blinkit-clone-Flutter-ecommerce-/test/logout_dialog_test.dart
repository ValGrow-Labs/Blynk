import 'dart:async';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/profile_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Organisms/logout_dialog.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';
import 'fixtures/gated_store.dart';
import 'fixtures/tracking_fakes.dart';

ProductModel _product() => const ProductModel(
      id: 'p1',
      categoryId: 'c',
      categoryName: 'Dairy',
      name: 'Milk',
      slug: 'milk',
      sku: 'SKU-1',
      unit: '1 L',
      sellingPrice: 100,
      isAvailable: true,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late AuthProvider auth;
  late CartProvider cart;
  late SpyLocationProvider location;
  late List<String> requests;
  late List<String> routes;

  setUp(() async {
    TokenStorage.resetSerialQueueForTest();
    FlutterSecureStorage.setMockInitialValues({
      'blynk_access_token': 'a',
      'blynk_refresh_token': 'r',
    });
    requests = [];
    routes = [];
    auth = AuthProvider(request: ({methodType, url, body}) async {
      requests.add('$methodType $url');
      return {'success': true};
    });
    await auth.restoreSession();
    cart = CartProvider()..add(_product());
    location = SpyLocationProvider();
  });

  tearDown(() {
    TokenStorage.resetSerialQueueForTest();
    auth.dispose();
    location.dispose();
  });

  Future<void> pumpHost(WidgetTester tester, {double textScale = 1, double width = 400}) async {
    tester.view.physicalSize = Size(width, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider(create: (_) => AddressProvider(request: ({methodType, url, body}) async => {})),
          ChangeNotifierProvider(create: (_) => OrderProvider(request: (m, u, {body, query}) async => {})),
          ChangeNotifierProvider<CartProvider>.value(value: cart),
          ChangeNotifierProvider<LocationProvider>.value(value: location),
        ],
        child: MaterialApp(
          theme: AppTheme.theme,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
            child: child!,
          ),
          onGenerateRoute: (settings) {
            routes.add(settings.name ?? '');
            return MaterialPageRoute(
              settings: settings,
              builder: (_) => settings.name == '/login'
                  ? const Scaffold(body: Center(child: Text('login screen')))
                  : Scaffold(
                      body: Builder(
                        builder: (context) => Center(
                          child: TextButton(
                            onPressed: () => showLogoutDialog(context),
                            child: const Text('open'),
                          ),
                        ),
                      ),
                    ),
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> open(WidgetTester tester) async {
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('asks "Log out?" with the plain body and two actions', (tester) async {
    await pumpHost(tester);
    await open(tester);

    expect(find.text('Log out?'), findsOneWidget);
    expect(find.text('You can browse without an account.'), findsOneWidget);
    expect(find.widgetWithText(BlynkButton, 'Log out'), findsOneWidget);
    expect(find.widgetWithText(BlynkButton, 'Cancel'), findsOneWidget);
    // Sentence case, no exclamation marks, and nothing Cupertino.
    expect(find.byType(CupertinoAlertDialog), findsNothing);
    expect(find.textContaining('!'), findsNothing);
    expect(find.text('LOG OUT'), findsNothing);
  });

  testWidgets('"Log out" is the destructive button and Cancel the secondary one', (tester) async {
    await pumpHost(tester);
    await open(tester);

    OutlinedButton outlined(String label) => tester.widget<OutlinedButton>(find.descendant(
          of: find.widgetWithText(BlynkButton, label),
          matching: find.byType(OutlinedButton),
        ));
    expect(outlined('Log out').style!.foregroundColor!.resolve({}), BlynkColors.problem);
    expect(outlined('Cancel').style!.foregroundColor!.resolve({}), BlynkColors.ink);
  });

  testWidgets('both actions are at least 48 dp tall and meet the tap-target guidelines', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpHost(tester);
    await open(tester);

    for (final label in ['Log out', 'Cancel']) {
      final size = tester.getSize(find.widgetWithText(BlynkButton, label));
      expect(size.height, greaterThanOrEqualTo(48), reason: label);
    }
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    handle.dispose();
  });

  for (final scale in kTextScales) {
    testWidgets('does not overflow at text scale $scale (360 dp wide)', (tester) async {
      await pumpHost(tester, textScale: scale, width: 360);
      await open(tester);
      expect(tester.takeException(), isNull);
      expect(find.text('Log out?'), findsOneWidget);
    });
  }

  testWidgets('Cancel closes it and changes nothing', (tester) async {
    await pumpHost(tester);
    await open(tester);

    await tester.tap(find.widgetWithText(BlynkButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(find.text('Log out?'), findsNothing);
    expect(auth.isAuthenticated, isTrue);
    expect(cart.itemCount, 1);
    expect(await TokenStorage.getRefreshToken(), 'r');
    expect(routes, ['/']);
  });

  testWidgets('dismissing it (back / scrim) also changes nothing', (tester) async {
    await pumpHost(tester);
    await open(tester);

    await tester.tapAt(const Offset(200, 20));
    await tester.pumpAndSettle();

    expect(find.text('Log out?'), findsNothing);
    expect(auth.isAuthenticated, isTrue);
  });

  testWidgets('Log out signs out, clears the user state and replaces the whole stack with /login', (tester) async {
    await pumpHost(tester);
    location.watch('order-1');
    await open(tester);

    await tester.tap(find.widgetWithText(BlynkButton, 'Log out'));
    await tester.pumpAndSettle();

    expect(auth.isAuthenticated, isFalse);
    expect(await TokenStorage.getRefreshToken(), isNull);
    expect(cart.isEmpty, isTrue);
    expect(location.calls.last, 'stop');
    expect(requests, contains('POST /auth/logout'));
    expect(routes.last, '/login');
    expect(find.text('login screen'), findsOneWidget);
    expect(find.text('open'), findsNothing, reason: 'nothing of the previous stack remains');
    // Only /login is left: there is nothing to go back to.
    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    expect(navigator.canPop(), isFalse);
  });

  testWidgets('with secure storage stuck, Log out still leaves the screen at once and clears the app state',
      (tester) async {
    final store = GatedStore()
      ..data.addAll({'blynk_access_token': 'a', 'blynk_refresh_token': 'r'})
      ..gate = ((op, key) => op == 'delete' ? Completer<void>().future : null); // every delete hangs
    TokenStorage.resetSerialQueueForTest(store: store);
    await pumpHost(tester);
    location.watch('order-1');
    await open(tester);

    await tester.tap(find.widgetWithText(BlynkButton, 'Log out'));
    await tester.pump(); // one frame: no waiting for storage
    await tester.pump(const Duration(milliseconds: 400));

    expect(routes.last, '/login');
    expect(find.text('login screen'), findsOneWidget);
    expect(auth.isAuthenticated, isFalse);
    expect(cart.isEmpty, isTrue);
    expect(location.calls.last, 'stop');
  });

  testWidgets('the Profile "Log out" row opens it for a signed-in customer', (tester) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider(create: (_) => AddressProvider(request: ({methodType, url, body}) async => {})),
          ChangeNotifierProvider(create: (_) => OrderProvider(request: (m, u, {body, query}) async => {})),
          ChangeNotifierProvider<CartProvider>.value(value: cart),
          ChangeNotifierProvider<LocationProvider>.value(value: location),
        ],
        child: MaterialApp(theme: AppTheme.theme, home: const ProfileScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Log out'));
    await tester.pumpAndSettle();

    expect(find.text('Log out?'), findsOneWidget);
    expect(find.byIcon(BlynkIcons.logout), findsOneWidget);
  });

  test('CupertinoLogoutDialog is referenced by no lib/ or test/ file', () {
    final offenders = <String>[];
    for (final root in ['lib', 'test']) {
      for (final file in Directory(root).listSync(recursive: true).whereType<File>()) {
        final path = file.path.replaceAll(r'\', '/');
        if (!path.endsWith('.dart') || path.endsWith('test/logout_dialog_test.dart')) continue;
        final source = file.readAsStringSync();
        if (source.contains('CupertinoLogoutDialog') || source.contains('cupertino_logout_dialog')) {
          offenders.add(path);
        }
      }
    }
    expect(offenders, isEmpty);
  });
}
