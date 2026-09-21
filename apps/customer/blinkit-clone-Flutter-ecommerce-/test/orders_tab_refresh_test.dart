import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/customer_shell.dart';
import 'package:ecom/Screens/user_orders_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/order_fixtures.dart';
import 'fixtures/session_fakes.dart';

/// Counts loads without a network; the clock is the test's.
class _CountingOrders extends OrderProvider {
  _CountingOrders(this.now) : super(clock: () => now.value);

  final _Clock now;
  int loads = 0;

  @override
  Future<void> loadOrders() async {
    loads++;
  }
}

class _Clock {
  DateTime value = DateTime.utc(2026, 9, 21, 10);
  void advance(Duration d) => value = value.add(d);
}

const _stubTabs = <Widget>[
  Center(child: Text('shop tab')),
  Center(child: Text('orders tab')),
  Center(child: Text('help tab')),
  Center(child: Text('profile tab')),
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // A widget test can end with a storage call unfinished; do not let it block the next test.
  setUp(() {
    TokenStorage.resetSerialQueueForTest();
    FlutterSecureStorage.setMockInitialValues({});
  });
  tearDown(TokenStorage.resetSerialQueueForTest);

  Future<void> pumpShell(
    WidgetTester tester, {
    required AuthProvider auth,
    required OrderProvider orders,
    List<Widget> tabs = _stubTabs,
    int initialTab = 0,
  }) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<OrderProvider>.value(value: orders),
          ChangeNotifierProvider(create: (_) => CartProvider()),
          ChangeNotifierProvider(create: (_) => AddressProvider(request: ({methodType, url, body}) async => {})),
          ChangeNotifierProvider(create: (_) => ProductProvider(request: (u, q) async => {})),
        ],
        child: MaterialApp(
          theme: AppTheme.theme,
          onGenerateRoute: (settings) {
            if (settings.name == '/detail') {
              return MaterialPageRoute(
                settings: settings,
                builder: (context) => Scaffold(
                  body: TextButton(
                    onPressed: () => CustomerShell.selectTab(context, 1),
                    child: const Text('go to orders'),
                  ),
                ),
              );
            }
            return MaterialPageRoute(
              settings: const RouteSettings(name: '/home'),
              builder: (_) => CustomerShell(initialTab: initialTab, tabs: tabs),
            );
          },
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 300));
  }

  Future<void> tapTab(WidgetTester tester, String label) async {
    await tester.tap(find.text(label));
    await tester.pump(const Duration(milliseconds: 300));
  }

  group('selecting the Orders tab', () {
    testWidgets('signed in: one load, and none at mount', (tester) async {
      final orders = _CountingOrders(_Clock());
      await pumpShell(tester, auth: SignedInAuth(), orders: orders);
      expect(orders.loads, 0);

      await tapTab(tester, 'Orders');

      expect(orders.loads, 1);
      expect(find.text('orders tab').hitTestable(), findsOneWidget);
    });

    testWidgets('guest: no load at all', (tester) async {
      final orders = _CountingOrders(_Clock());
      await pumpShell(tester, auth: AuthProvider(), orders: orders);

      await tapTab(tester, 'Orders');
      await tapTab(tester, 'Help');
      await tapTab(tester, 'Orders');

      expect(orders.loads, 0);
    });

    testWidgets('reselecting within the throttle window does not refetch; after it, it does', (tester) async {
      final clock = _Clock();
      final orders = _CountingOrders(clock);
      await pumpShell(tester, auth: SignedInAuth(), orders: orders);

      await tapTab(tester, 'Orders');
      await tapTab(tester, 'Shop');
      clock.advance(const Duration(seconds: 10));
      await tapTab(tester, 'Orders');
      expect(orders.loads, 1, reason: 'inside the window');

      await tapTab(tester, 'Shop');
      clock.advance(OrderProvider.refreshMinInterval);
      await tapTab(tester, 'Orders');
      expect(orders.loads, 2, reason: 'the window has passed');
    });

    testWidgets('tapping Orders while already on it does not load again', (tester) async {
      final clock = _Clock();
      final orders = _CountingOrders(clock);
      await pumpShell(tester, auth: SignedInAuth(), orders: orders);
      await tapTab(tester, 'Orders');
      clock.advance(const Duration(minutes: 5));

      await tapTab(tester, 'Orders');

      expect(orders.loads, 1);
    });

    testWidgets('CustomerShell.selectTab from a pushed page loads once', (tester) async {
      final orders = _CountingOrders(_Clock());
      await pumpShell(tester, auth: SignedInAuth(), orders: orders);
      tester.state<NavigatorState>(find.byType(Navigator)).pushNamed('/detail');
      await tester.pumpAndSettle();

      await tester.tap(find.text('go to orders'));
      await tester.pumpAndSettle();

      expect(orders.loads, 1);
      expect(find.text('orders tab').hitTestable(), findsOneWidget);
    });

    testWidgets('a rebuild of the shell does not load (no fetch loop)', (tester) async {
      final orders = _CountingOrders(_Clock());
      final auth = SignedInAuth();
      await pumpShell(tester, auth: auth, orders: orders);
      await tapTab(tester, 'Orders');

      auth.notifyListeners();
      orders.notifyListeners();
      await tester.pump();
      await tester.pump(const Duration(seconds: 60));

      expect(orders.loads, 1);
    });

    testWidgets('a shell that starts on Orders makes exactly one load (the screen\'s own)', (tester) async {
      final orders = _CountingOrders(_Clock());
      await pumpShell(
        tester,
        auth: SignedInAuth(),
        orders: orders,
        initialTab: 1,
        tabs: const [SizedBox(), OrdersScreen(), SizedBox(), SizedBox()],
      );
      await tester.pump();

      expect(orders.loads, 1);
    });

    testWidgets('with the real Orders screen: one load at mount, none when the tab is selected right after',
        (tester) async {
      final orders = _CountingOrders(_Clock());
      await pumpShell(
        tester,
        auth: SignedInAuth(),
        orders: orders,
        tabs: const [SizedBox(), OrdersScreen(), SizedBox(), SizedBox()],
      );
      await tester.pump();
      expect(orders.loads, 1, reason: 'the screen loads once when the shell mounts');

      await tapTab(tester, 'Orders');

      expect(orders.loads, 1, reason: 'selecting it right after is inside the window');
    });
  });

  group('OrderProvider.refreshOrders', () {
    ProductModel product() => const ProductModel(
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

    test('placing an order makes the list stale at once: the next selection fetches', () async {
      final clock = _Clock();
      var listFetches = 0;
      final orders = OrderProvider(
        clock: () => clock.value,
        request: (method, url, {body, query}) async {
          if (method == 'POST') {
            return {'success': true, 'data': {'order': orderJson()}};
          }
          listFetches++;
          return {'success': true, 'data': {'orders': [], 'pagination': {'total_pages': 1}}};
        },
      );
      await orders.refreshOrders(force: true);
      clock.advance(const Duration(seconds: 5));
      await orders.refreshOrders();
      expect(listFetches, 1, reason: 'throttled');

      await orders.placeOrder(cart: CartProvider()..add(product()), addressId: 'a1');
      await orders.refreshOrders();

      expect(listFetches, 2);
    });

    test('a logout (reset) clears the throttle for the next customer', () async {
      final clock = _Clock();
      var listFetches = 0;
      final orders = OrderProvider(
        clock: () => clock.value,
        request: (method, url, {body, query}) async {
          listFetches++;
          return {'success': true, 'data': {'orders': [], 'pagination': {'total_pages': 1}}};
        },
      );
      await orders.refreshOrders(force: true);

      orders.reset();
      await orders.refreshOrders();

      expect(listFetches, 2);
    });

    test('an unforced refresh does not stack on a load that is running', () async {
      var listFetches = 0;
      final orders = OrderProvider(
        request: (method, url, {body, query}) async {
          listFetches++;
          await Future<void>.delayed(const Duration(milliseconds: 20));
          return {'success': true, 'data': {'orders': [], 'pagination': {'total_pages': 1}}};
        },
      );
      final first = orders.refreshOrders(force: true);
      await orders.refreshOrders();
      await first;

      expect(listFetches, 1);
    });
  });
}
