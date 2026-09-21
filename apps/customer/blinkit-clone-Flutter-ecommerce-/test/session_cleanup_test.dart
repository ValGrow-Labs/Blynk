import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/app_session_cleaner.dart';

import 'fixtures/order_fixtures.dart';
import 'fixtures/tracking_fakes.dart';

ProductModel _product(String id) => ProductModel(
      id: id,
      categoryId: 'c',
      categoryName: 'Dairy',
      name: 'Item $id',
      slug: 'item-$id',
      sku: 'SKU-$id',
      unit: '1 pc',
      sellingPrice: 100,
      isAvailable: true,
    );

Map<String, dynamic> _addressJson(String id, {bool isDefault = false}) => {
      'id': id,
      'label': 'Home',
      'recipient_name': 'Nimal',
      'recipient_phone': '+94771234567',
      'address_line1': '12 Galle Road',
      'city': 'Dharga Town',
      'latitude': 6.5,
      'longitude': 80.1,
      'is_default': isDefault,
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  late AddressProvider addresses;
  late OrderProvider orders;
  late CartProvider cart;
  late SpyLocationProvider location;

  /// The real ways this state gets in: an addresses fetch, an orders fetch,
  /// cart taps and a rider stream that has delivered a live point.
  Future<void> fillUserState() async {
    await addresses.loadAddresses();
    cart.add(_product('p1'));
    cart.add(_product('p2'));
    await orders.loadOrders();
    location.watch('order-1');
    location.sendPoint();
    await Future<void>.delayed(Duration.zero);
  }

  void clearAll() => AppSessionCleaner.clearProviders(
        addresses: addresses,
        orders: orders,
        cart: cart,
        location: location,
      );

  setUp(() {
    addresses = AddressProvider(
      request: ({methodType, url, body}) async => {
        'success': true,
        'data': {
          'addresses': [_addressJson('a1', isDefault: true), _addressJson('a2')],
        },
      },
    );
    orders = OrderProvider(
      request: (method, url, {body, query}) async => {
        'success': true,
        'data': {
          'orders': [orderJson(detail: false)],
          'pagination': {'total_pages': 3},
        },
      },
    );
    cart = CartProvider();
    location = SpyLocationProvider();
  });

  tearDown(() => location.dispose());

  void expectClean() {
    expect(addresses.addresses, isEmpty);
    expect(addresses.defaultAddress, isNull);
    expect(addresses.errorMessage, isNull);
    expect(orders.orders, isEmpty);
    expect(orders.lastPlacedOrder, isNull);
    expect(orders.hasMoreOrders, isFalse);
    expect(orders.ordersError, isNull);
    expect(cart.isEmpty, isTrue);
    expect(cart.itemCount, 0);
    expect(location.current, isNull);
    expect(location.closed, isFalse);
  }

  test('the providers do hold the previous customer\'s data before the cleanup', () async {
    await fillUserState();
    expect(addresses.addresses, hasLength(2));
    expect(addresses.defaultAddress?.id, 'a1');
    expect(orders.orders, hasLength(1));
    expect(orders.hasMoreOrders, isTrue);
    expect(cart.itemCount, 2);
    expect(location.current, isNotNull);
  });

  test('clearProviders empties addresses, orders, cart and the location point', () async {
    await fillUserState();

    clearAll();

    expectClean();
  });

  test('the live rider stream is stopped through the provider\'s own stop API', () async {
    await fillUserState();
    final stopsBefore = location.stopCount;

    clearAll();

    expect(location.stopCount, stopsBefore + 1);
    expect(location.calls.last, 'stop');
  });

  test('a new customer can watch a new order after the cleanup', () async {
    await fillUserState();
    clearAll();

    location.watch('order-2');
    location.sendPoint(lat: 7.1);
    await Future<void>.delayed(Duration.zero);

    expect(location.opened, ['order-1', 'order-2']);
    expect(location.current?.latitude, 7.1);
  });

  testWidgets('clearUserScopedState reads the four providers from the tree', (tester) async {
    await tester.runAsync(fillUserState);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AddressProvider>.value(value: addresses),
          ChangeNotifierProvider<OrderProvider>.value(value: orders),
          ChangeNotifierProvider<CartProvider>.value(value: cart),
          ChangeNotifierProvider<LocationProvider>.value(value: location),
        ],
        child: MaterialApp(
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () => AppSessionCleaner.clearUserScopedState(context),
              child: const Text('clear'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('clear'));

    expectClean();
  });

  test('a list request in flight at logout does not repopulate the orders', () async {
    final slow = OrderProvider(
      request: (method, url, {body, query}) async {
        await Future<void>.delayed(const Duration(milliseconds: 5));
        return {
          'success': true,
          'data': {
            'orders': [orderJson(detail: false)],
            'pagination': {'total_pages': 1},
          },
        };
      },
    );
    final pending = slow.loadOrders();
    slow.reset();
    await pending;

    expect(slow.orders, isEmpty);
    expect(slow.isLoadingOrders, isFalse);
  });

  test('a placed order and its confirmation state are forgotten', () async {
    final placing = OrderProvider(
      request: (method, url, {body, query}) async => {
        'success': true,
        'data': {'order': orderJson()},
      },
    );
    final basket = CartProvider()..add(_product('p1'));
    await placing.placeOrder(cart: basket, addressId: 'a1');
    expect(placing.lastPlacedOrder, isA<OrderModel>());

    placing.reset();

    expect(placing.lastPlacedOrder, isNull);
    expect(placing.placeOrderError, isNull);
    expect(placing.isPlacingOrder, isFalse);
  });

  test('the product catalog is public: the cleaner does not know it, so it cannot clear it', () {
    // The behavioural half would be vacuous (the cleaner is never handed the
    // catalog), so this guards the structure: adding it here fails the test.
    final source = File('lib/Services/app_session_cleaner.dart').readAsStringSync();
    expect(source, isNot(contains('product.provider')));
    expect(source, isNot(contains('ProductProvider')));
  });

  test('every cleared provider notifies, so mounted screens rebuild empty', () async {
    await fillUserState();
    final notified = <String>[];
    addresses.addListener(() => notified.add('addresses'));
    orders.addListener(() => notified.add('orders'));
    cart.addListener(() => notified.add('cart'));
    location.addListener(() => notified.add('location'));

    clearAll();

    expect(notified.toSet(), {'addresses', 'orders', 'cart', 'location'});
  });

  test('the forced session end and the logout dialog both go through the one cleaner', () {
    final listener = File('lib/Screens/session_gate.dart').readAsStringSync();
    final dialog = File('lib/UI/Widgets/Organisms/logout_dialog.dart').readAsStringSync();
    expect(listener, contains('AppSessionCleaner.clearUserScopedState'));
    expect(dialog, contains('AppSessionCleaner.clearProviders'));
  });
}
