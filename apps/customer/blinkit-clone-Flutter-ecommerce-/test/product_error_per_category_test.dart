import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/app_errors.dart';

Map<String, dynamic> _page(String name) => {
      'success': true,
      'data': {
        'products': [
          {
            'id': 'p-$name',
            'category_id': 'c',
            'category_name': 'C',
            'name': name,
            'slug': name,
            'sku': 's-$name',
            'unit': '1 L',
            'selling_price': 100,
            'is_available': true,
          },
        ],
        'pagination': {'page': 1, 'limit': 100, 'total': 1, 'total_pages': 1},
      },
    };

void main() {
  // category_slug -> what the fake backend answers (a value or a thrown error).
  late Map<String, Object> answers;
  late List<String> calls;
  late ProductProvider products;

  setUp(() {
    answers = {};
    calls = [];
    products = ProductProvider(request: (url, query) async {
      final slug = (query['category_slug'] as String?) ?? '';
      calls.add(slug);
      final answer = answers[slug];
      if (answer is Exception) throw answer;
      return answer ?? _page(slug.isEmpty ? 'all' : slug);
    });
  });

  test('a failure in one category leaves every other category untouched', () async {
    await products.loadProducts(categorySlug: 'dairy');
    answers['snacks'] = ApiException(503, 'x', code: 'NETWORK_ERROR');

    await products.loadProducts(categorySlug: 'snacks');

    expect(products.productsFailureFor('snacks')?.kind, CustomerErrorKind.offline);
    expect(products.productsErrorFor('snacks'), isNotNull);
    // Dairy still has its data and no error: the old single field showed
    // "something went wrong" over it.
    expect(products.productsFailureFor('dairy'), isNull);
    expect(products.productsErrorFor('dairy'), isNull);
    expect(products.productsFor('dairy'), hasLength(1));
    expect(products.productsFailureFor(''), isNull);
  });

  test('the failure is cleared by a successful load of the same category', () async {
    answers['snacks'] = ApiException(500, 'boom');
    await products.loadProducts(categorySlug: 'snacks');
    expect(products.productsFailureFor('snacks')?.kind, CustomerErrorKind.server);

    answers.remove('snacks');
    await products.loadProducts(categorySlug: 'snacks');

    expect(products.productsFailureFor('snacks'), isNull);
    expect(products.productsFor('snacks'), hasLength(1));
  });

  test('a retry clears the failure as soon as it starts (the skeleton shows, not the stale error)', () async {
    answers['snacks'] = ApiException(500, 'boom');
    await products.loadProducts(categorySlug: 'snacks');

    answers.remove('snacks');
    final retry = products.loadProducts(categorySlug: 'snacks');
    expect(products.isLoadingProducts('snacks'), isTrue);
    expect(products.productsFailureFor('snacks'), isNull);
    await retry;
  });

  test('a failed refresh of a category that has data keeps the data and raises no error', () async {
    await products.loadProducts(categorySlug: 'dairy');
    answers['dairy'] = ApiException(503, 'x', code: 'NETWORK_ERROR');

    await products.loadProducts(categorySlug: 'dairy', force: true);

    expect(products.productsFailureFor('dairy'), isNull);
    expect(products.productsFor('dairy'), hasLength(1));
  });

  test('two categories can fail independently and recover independently', () async {
    answers['a'] = ApiException(500, 'x');
    answers['b'] = ApiException(408, 'x', code: 'TIMEOUT');
    await products.loadProducts(categorySlug: 'a');
    await products.loadProducts(categorySlug: 'b');
    expect(products.productsFailureFor('a')?.kind, CustomerErrorKind.server);
    expect(products.productsFailureFor('b')?.kind, CustomerErrorKind.timeout);

    answers.remove('a');
    await products.loadProducts(categorySlug: 'a');

    expect(products.productsFailureFor('a'), isNull);
    expect(products.productsFailureFor('b')?.kind, CustomerErrorKind.timeout);
  });

  test('"all products" is its own key', () async {
    answers[''] = ApiException(500, 'x');
    await products.loadProducts();
    expect(products.productsFailureFor(''), isNotNull);
    expect(products.productsFailureFor('dairy'), isNull);
  });

  test('the stored message is customer copy, never the exception text', () async {
    answers['snacks'] = ApiException(500, 'relation "products" does not exist');
    await products.loadProducts(categorySlug: 'snacks');
    expect(products.productsErrorFor('snacks'), isNot(contains('relation')));
    expect(products.productsErrorFor('snacks'), AppErrors.server.message);
  });

  test('categories and search failures are customer copy as well', () async {
    final failing = ProductProvider(request: (url, query) async {
      throw ApiException(500, 'select * from secrets');
    });
    await failing.loadCategories();
    await failing.search('milk');
    expect(failing.categoriesError, AppErrors.server.message);
    expect(failing.categoriesFailure?.kind, CustomerErrorKind.server);
    expect(failing.searchError, AppErrors.server.message);
    expect(failing.searchFailure?.kind, CustomerErrorKind.server);
  });

  test('the old single-field getter is gone', () {
    // ignore: avoid_dynamic_calls
    expect(() => (products as dynamic).productsError, throwsNoSuchMethodError);
  });
}
