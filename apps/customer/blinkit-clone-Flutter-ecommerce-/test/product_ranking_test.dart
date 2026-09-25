import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/product_ranking.dart';

/// Blynk's whole "recommendation" is one honest question: which of these
/// products has THIS customer actually bought, how recently, how often.
///
/// These tests pin both halves of that — that the ordering is right, and that
/// it refuses to do anything at all without real orders behind it.
ProductModel _p(String id) => ProductModel(
      id: id,
      categoryId: 'c',
      categoryName: 'Dairy',
      name: 'Product $id',
      slug: id,
      sku: 'SKU-$id',
      unit: '1 L',
      sellingPrice: 100,
      isAvailable: true,
    );

/// An order containing [productIds]. Orders are passed newest-first, exactly
/// as `GET /orders` returns them.
OrderModel _order(List<String> productIds, {String id = 'o'}) => OrderModel.fromJson({
      'id': id,
      'order_number': id,
      'status': 'DELIVERED',
      'items': [
        // Each line needs its own id: OrderItemModel.tryParse drops any item
        // without one, which is how an order can arrive with zero readable
        // lines even though it clearly had contents.
        for (var i = 0; i < productIds.length; i++)
          {
            'id': '$id-line-$i',
            'product_id': productIds[i],
            'product_name_snapshot': 'Product ${productIds[i]}',
            'quantity': 1,
          },
      ],
    });

void main() {
  group('PurchaseHistorySignal', () {
    test('no orders means no signal, so nothing may be claimed', () {
      final signal = PurchaseHistorySignal.fromOrders(const []);
      expect(signal.isEmpty, isTrue);
      expect(signal.isNotEmpty, isFalse);
      expect(signal.productCount, 0);
    });

    test('orders with no readable line items still produce no signal', () {
      // The list endpoint returns items, but an order that arrived without
      // them must not be counted as evidence of anything.
      final signal = PurchaseHistorySignal.fromOrders([_order(const [])]);
      expect(signal.isEmpty, isTrue);
    });

    test('counts distinct ORDERS containing a product, not units', () {
      // Buying the same product twice in one order is one signal. Counting
      // units would let a single bulk order dominate the whole grid.
      final signal = PurchaseHistorySignal.fromOrders([
        _order(['milk', 'milk', 'milk'], id: 'o1'),
      ]);
      expect(signal.ordersContaining['milk'], 1);
    });

    test('counts a product once per order across several orders', () {
      final signal = PurchaseHistorySignal.fromOrders([
        _order(['milk', 'bread'], id: 'o1'),
        _order(['milk'], id: 'o2'),
        _order(['milk', 'eggs'], id: 'o3'),
      ]);
      expect(signal.ordersContaining['milk'], 3);
      expect(signal.ordersContaining['bread'], 1);
      expect(signal.productCount, 3);
    });

    test('recency is the newest order containing it, 0 being the newest', () {
      final signal = PurchaseHistorySignal.fromOrders([
        _order(['eggs'], id: 'newest'),
        _order(['milk'], id: 'middle'),
        _order(['milk', 'bread'], id: 'oldest'),
      ]);
      expect(signal.recencyRank['eggs'], 0);
      expect(signal.recencyRank['milk'], 1, reason: 'the NEWEST order containing it');
      expect(signal.recencyRank['bread'], 2);
    });

    test('an empty product id is not a product', () {
      final signal = PurchaseHistorySignal.fromOrders([_order(['', 'milk'])]);
      expect(signal.productCount, 1);
      expect(signal.boughtBefore('milk'), isTrue);
      expect(signal.boughtBefore(''), isFalse);
    });
  });

  group('rankByPurchaseHistory', () {
    final catalogue = [_p('a'), _p('b'), _p('c'), _p('d')];

    test('with no signal the backend order is left exactly as it came', () {
      final ranked = rankByPurchaseHistory(catalogue, PurchaseHistorySignal.none);
      expect(ranked.map((p) => p.id).toList(), ['a', 'b', 'c', 'd']);
    });

    test('bought-before products come first; the rest keep catalogue order', () {
      final signal = PurchaseHistorySignal.fromOrders([_order(['c'])]);
      final ranked = rankByPurchaseHistory(catalogue, signal);
      expect(ranked.map((p) => p.id).toList(), ['c', 'a', 'b', 'd']);
    });

    test('more recently bought outranks more often bought', () {
      // 'a' was bought in three orders but not lately; 'd' was bought in the
      // newest one. Recency is the stronger signal for a grocery shop.
      final signal = PurchaseHistorySignal.fromOrders([
        _order(['d'], id: 'o1'),
        _order(['a'], id: 'o2'),
        _order(['a'], id: 'o3'),
        _order(['a'], id: 'o4'),
      ]);
      final ranked = rankByPurchaseHistory(catalogue, signal);
      expect(ranked.map((p) => p.id).take(2).toList(), ['d', 'a']);
    });

    test('frequency breaks a recency tie', () {
      // Both last appeared in the same order, so the one bought more often
      // across history wins.
      final signal = PurchaseHistorySignal.fromOrders([
        _order(['a', 'b'], id: 'o1'),
        _order(['b'], id: 'o2'),
      ]);
      final ranked = rankByPurchaseHistory(catalogue, signal);
      expect(ranked.map((p) => p.id).take(2).toList(), ['b', 'a']);
    });

    test('catalogue position breaks a full tie, so the grid never shuffles', () {
      // Dart's List.sort is NOT stable. Without the final tie-break, two
      // equally-ranked products could swap places between rebuilds and the
      // customer would watch the grid reshuffle under their thumb.
      final signal = PurchaseHistorySignal.fromOrders([_order(['d', 'b', 'c'])]);
      final first = rankByPurchaseHistory(catalogue, signal).map((p) => p.id).toList();
      expect(first, ['b', 'c', 'd', 'a'], reason: 'catalogue order among equals');

      for (var i = 0; i < 20; i++) {
        expect(rankByPurchaseHistory(catalogue, signal).map((p) => p.id).toList(), first,
            reason: 'the same inputs must always give the same order');
      }
    });

    test('never drops, duplicates or invents a product', () {
      final signal = PurchaseHistorySignal.fromOrders([
        _order(['c', 'a'], id: 'o1'),
        _order(['not-in-catalogue'], id: 'o2'),
      ]);
      final ranked = rankByPurchaseHistory(catalogue, signal);
      expect(ranked, hasLength(catalogue.length));
      expect(ranked.map((p) => p.id).toSet(), catalogue.map((p) => p.id).toSet());
    });

    test('does not mutate the list it was given', () {
      final source = [_p('a'), _p('b')];
      final signal = PurchaseHistorySignal.fromOrders([_order(['b'])]);
      rankByPurchaseHistory(source, signal);
      expect(source.map((p) => p.id).toList(), ['a', 'b']);
    });

    test('an empty or single-product catalogue is returned unharmed', () {
      final signal = PurchaseHistorySignal.fromOrders([_order(['a'])]);
      expect(rankByPurchaseHistory(const [], signal), isEmpty);
      expect(rankByPurchaseHistory([_p('a')], signal).single.id, 'a');
    });
  });
}
