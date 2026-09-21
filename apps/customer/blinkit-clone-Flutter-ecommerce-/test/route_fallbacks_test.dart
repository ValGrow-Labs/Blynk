import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/customer_shell.dart';
import 'package:ecom/Screens/not_found_screen.dart';
import 'package:ecom/Screens/order_summary_screen.dart';
import 'package:ecom/Screens/product_details_screen.dart';
import 'package:ecom/Screens/products_screen.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/app_state_views.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/route_generator.dart';

ProductModel _product({String id = 'p1'}) => ProductModel.fromJson({
      'id': id,
      'category_id': 'c1',
      'category_name': 'Dairy',
      'name': 'Milk',
      'slug': 'milk',
      'sku': 'S1',
      'unit': '1 L',
      'selling_price': 540,
      'is_available': true,
    });

/// The page a route would build, without running the page.
Future<Widget> _build(WidgetTester tester, String? name, {Object? arguments}) async {
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
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('unknown routes', () {
    for (final name in ['/nope', '/orders/123', '/product/extra', '', 'home', '/ORDER']) {
      testWidgets('"$name" is the not-found screen', (tester) async {
        expect(await _build(tester, name), isA<NotFoundScreen>());
      });
    }

    testWidgets('a null route name is not-found too', (tester) async {
      expect(await _build(tester, null), isA<NotFoundScreen>());
    });
  });

  group('/product', () {
    testWidgets('a product or a non-empty id opens the details page', (tester) async {
      expect(await _build(tester, '/product', arguments: _product()), isA<ProductDetailsScreen>());
      expect(await _build(tester, '/product', arguments: 'p1'), isA<ProductDetailsScreen>());
      final page = await _build(tester, '/product', arguments: 'p1') as ProductDetailsScreen;
      expect(page.productId, 'p1');
    });

    testWidgets('missing, empty, blank or wrong-typed arguments are not-found at once', (tester) async {
      for (final args in <Object?>[null, '', '   ', 42, 3.5, true, <String>['p1'], {'id': 'p1'}, _product(id: '')]) {
        expect(await _build(tester, '/product', arguments: args), isA<NotFoundScreen>(), reason: '$args');
      }
    });
  });

  group('/order', () {
    testWidgets('a non-empty id opens the order', (tester) async {
      final page = await _build(tester, '/order', arguments: 'o1');
      expect(page, isA<OrderSummaryScreen>());
      expect((page as OrderSummaryScreen).orderId, 'o1');
    });

    testWidgets('missing, empty, blank or wrong-typed arguments are not-found', (tester) async {
      for (final args in <Object?>[null, '', '  ', 7, _product(), {'id': 'o1'}]) {
        expect(await _build(tester, '/order', arguments: args), isA<NotFoundScreen>(), reason: '$args');
      }
    });

    testWidgets('an empty id never asks the backend for GET /orders/', (tester) async {
      final requests = <String>[];
      final orders = OrderProvider(request: (method, url, {body, query}) async {
        requests.add('$method $url');
        return {'data': {}};
      });
      final key = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        ChangeNotifierProvider<OrderProvider>.value(
          value: orders,
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            navigatorKey: key,
            onGenerateRoute: AppRouter.generateRoute,
            home: const SizedBox(),
          ),
        ),
      );
      unawaited(key.currentState!.pushNamed('/order'));
      await tester.pumpAndSettle();

      expect(find.text("This page isn't available"), findsOneWidget);
      expect(requests, isEmpty);
    });
  });

  group('/products and /search', () {
    testWidgets('no argument means everything; a slug is passed through', (tester) async {
      expect(await _build(tester, '/products'), isA<ProductsScreen>());
      final page = await _build(tester, '/products', arguments: 'dairy') as ProductsScreen;
      expect(page.categorySlug, 'dairy');
      expect((await _build(tester, '/products') as ProductsScreen).categorySlug, '');
      expect(await _build(tester, '/search'), isA<SearchScreen>());
      expect(await _build(tester, '/search', arguments: 'dairy'), isA<SearchScreen>());
    });

    testWidgets('a wrong-typed argument is not-found instead of a cast error', (tester) async {
      for (final args in <Object>[42, true, _product(), ['dairy']]) {
        expect(await _build(tester, '/products', arguments: args), isA<NotFoundScreen>(), reason: '$args');
        expect(await _build(tester, '/search', arguments: args), isA<NotFoundScreen>(), reason: '$args');
      }
    });
  });

  group('valid navigation is untouched', () {
    testWidgets('the shell still takes a tab index; anything else is tab 0', (tester) async {
      final shell = await _build(tester, '/home', arguments: 1) as CustomerShell;
      expect(shell.initialTab, 1);
      expect((await _build(tester, '/home') as CustomerShell).initialTab, 0);
      expect((await _build(tester, '/home', arguments: 'x') as CustomerShell).initialTab, 0);
    });
  });

  group('the not-found screen', () {
    testWidgets('says the page is not available and offers one way out', (tester) async {
      await tester.pumpWidget(MaterialApp(theme: AppTheme.appTHeme, home: const NotFoundScreen()));

      expect(find.byType(AppStateView), findsOneWidget);
      expect(find.text("This page isn't available"), findsOneWidget);
      expect(find.text('Go to Shop'), findsOneWidget);
      final texts = tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '').join(' ');
      expect(texts.contains('!'), isFalse);
    });

    testWidgets('"Go to Shop" goes to /home and clears the stack', (tester) async {
      final pushed = <String?>[];
      final key = GlobalKey<NavigatorState>();
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.appTHeme,
        navigatorKey: key,
        onGenerateRoute: (settings) {
          pushed.add(settings.name);
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => settings.name == '/home' ? const Text('shop') : const NotFoundScreen(),
          );
        },
        initialRoute: '/missing',
      ));

      await tester.tap(find.text('Go to Shop'));
      await tester.pumpAndSettle();

      expect(pushed.last, '/home');
      expect(find.text('shop'), findsOneWidget);
      expect(key.currentState!.canPop(), isFalse);
    });

    for (final scale in [1.0, 2.0]) {
      testWidgets('does not overflow at text scale $scale and keeps a 48 dp action', (tester) async {
        tester.view.physicalSize = const Size(320, 480);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(MaterialApp(
          theme: AppTheme.appTHeme,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
            child: child!,
          ),
          home: const NotFoundScreen(),
        ));
        expect(tester.takeException(), isNull);
        final button = find.text('Go to Shop');
        await tester.ensureVisible(button);
        expect(tester.getSize(find.ancestor(of: button, matching: find.byType(OutlinedButton)).first).height, greaterThanOrEqualTo(48));
      });
    }
  });

  group('the old error screen', () {
    test('nothing in lib/ or test/ refers to ErrorScreem any more', () {
      for (final dir in ['lib', 'test']) {
        for (final f in Directory(dir).listSync(recursive: true).whereType<File>()) {
          if (!f.path.endsWith('.dart') || f.path.endsWith('route_fallbacks_test.dart')) continue;
          expect(f.readAsStringSync().contains('ErrorScreem'), isFalse, reason: f.path);
        }
      }
    });

    test('no file imports error_screen.dart', () {
      for (final dir in ['lib', 'test']) {
        for (final f in Directory(dir).listSync(recursive: true).whereType<File>()) {
          if (!f.path.endsWith('.dart') || f.path.endsWith('route_fallbacks_test.dart')) continue;
          expect(f.readAsStringSync().contains('error_screen.dart'), isFalse, reason: f.path);
        }
      }
    });
  });
}
