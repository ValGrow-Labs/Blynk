import '../Models/order_model.dart';
import '../Models/product_model.dart';

/// Orders the catalogue against **one customer's own purchase history**.
///
/// This is the whole of Blynk's "recommendation": it is not a model, not a
/// score and not a prediction. It answers one question the backend can
/// already prove — *which of these products has this customer actually
/// bought, how recently, and how often* — and puts those first.
///
/// **What it deliberately is not.** There is no recommendations endpoint in
/// this backend, no popularity or sales signal on the catalogue (the server
/// orders products by name), and no cross-customer data of any kind reaches
/// this app. So nothing here can honestly claim "Trending", "Popular right
/// now" or "Customers also bought" — those would be invented, which is the
/// defect `home_composition_test.dart` has guarded against from the start.
/// That guard still stands; this ranking passes it because every input is a
/// real order the customer placed, and because the section only claims to be
/// based on their orders when [PurchaseHistorySignal.isEmpty] is false.
///
/// **It is per-customer and never leaves the device.** The input is the
/// signed-in customer's own `/orders` response, which they can already read
/// in full on the Orders screen. A signed-out or brand-new customer produces
/// an empty signal and the catalogue is left exactly as the backend sent it.
class PurchaseHistorySignal {
  const PurchaseHistorySignal({
    required this.ordersContaining,
    required this.recencyRank,
  });

  /// Product id -> how many distinct orders contained it. Counted per order,
  /// not per unit: buying six eggs once is one signal, not six.
  final Map<String, int> ordersContaining;

  /// Product id -> position of the most recent order containing it, where 0
  /// is the customer's newest order.
  final Map<String, int> recencyRank;

  /// No orders, or no orders whose lines this app could read. The caller must
  /// treat this as "we know nothing" and make no personalised claim.
  bool get isEmpty => ordersContaining.isEmpty;

  bool get isNotEmpty => !isEmpty;

  /// How many distinct products the customer has bought before.
  int get productCount => ordersContaining.length;

  static const PurchaseHistorySignal none = PurchaseHistorySignal(
    ordersContaining: <String, int>{},
    recencyRank: <String, int>{},
  );

  /// Builds the signal from the customer's orders, **newest first** — the
  /// order `GET /orders` already returns them in (`created_at desc`).
  ///
  /// Orders are taken as given rather than re-sorted here: the list endpoint
  /// is the authority on recency, and re-deriving it from a parsed date would
  /// silently disagree with it the moment a timestamp failed to parse.
  factory PurchaseHistorySignal.fromOrders(List<OrderModel> newestFirst) {
    final counts = <String, int>{};
    final recency = <String, int>{};

    for (var i = 0; i < newestFirst.length; i++) {
      // Distinct products in THIS order, so two lines of the same product in
      // one order still count once.
      final seen = <String>{};
      for (final item in newestFirst[i].items) {
        final id = item.productId;
        if (id.isEmpty || !seen.add(id)) continue;
        counts[id] = (counts[id] ?? 0) + 1;
        // The first time we meet it, walking newest to oldest, is its recency.
        recency[id] ??= i;
      }
    }

    return PurchaseHistorySignal(ordersContaining: counts, recencyRank: recency);
  }

  /// True when the customer has bought this product before.
  bool boughtBefore(String productId) => ordersContaining.containsKey(productId);
}

/// Returns [products] reordered so the ones this customer has bought before
/// come first, then everything else **in the order the backend sent it**.
///
/// Within the bought-before group the order is: most recently bought first,
/// then most frequently bought, then catalogue position. The last tie-break
/// is what makes this a *total* order — `List.sort` is not stable in Dart, so
/// without it two equally-ranked products could swap places between rebuilds
/// and the grid would visibly shuffle under the customer.
///
/// With an empty signal this returns a copy in the original order: no signal,
/// no reordering, nothing claimed.
List<ProductModel> rankByPurchaseHistory(
  List<ProductModel> products,
  PurchaseHistorySignal signal,
) {
  if (signal.isEmpty || products.length < 2) return List<ProductModel>.of(products);

  final catalogueIndex = <String, int>{};
  for (var i = 0; i < products.length; i++) {
    catalogueIndex.putIfAbsent(products[i].id, () => i);
  }

  final bought = <ProductModel>[];
  final rest = <ProductModel>[];
  for (final p in products) {
    (signal.boughtBefore(p.id) ? bought : rest).add(p);
  }

  bought.sort((a, b) {
    final byRecency = signal.recencyRank[a.id]!.compareTo(signal.recencyRank[b.id]!);
    if (byRecency != 0) return byRecency;
    final byFrequency =
        signal.ordersContaining[b.id]!.compareTo(signal.ordersContaining[a.id]!);
    if (byFrequency != 0) return byFrequency;
    return (catalogueIndex[a.id] ?? 0).compareTo(catalogueIndex[b.id] ?? 0);
  });

  return <ProductModel>[...bought, ...rest];
}
