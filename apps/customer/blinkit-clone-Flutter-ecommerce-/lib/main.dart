import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:provider/provider.dart';
import 'package:provider/single_child_widget.dart';

import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/route_generator.dart';

// Shared so lib/UI/Widgets/Atoms/app_toast.dart can show a SnackBar on
// platforms fluttertoast doesn't support, without needing a BuildContext.
final rootScaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Load environment variables (.env file)
  try {
    await dotenv.load(fileName: ".env");
  } catch (_) {
    // If .env is not found or fails to load, fallback defaults in ApiService are used
  }

  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.white,
      statusBarIconBrightness: Brightness.dark,
    ),
  );

  runApp(
    MultiProvider(
      providers: buildAppProviders(),
      child: const MainApp(),
    ),
  );
}

/// The app's provider tree. A function (not inline in [main]) so a test can
/// check what is registered without running the app.
List<SingleChildWidget> buildAppProviders() => [
      ChangeNotifierProvider<AuthProvider>(
        create: (_) => AuthProvider()..restoreSession(),
      ),
      ChangeNotifierProvider<ProductProvider>(
        create: (_) => ProductProvider(),
      ),
      ChangeNotifierProvider<CartProvider>(
        create: (_) => CartProvider(),
      ),
      ChangeNotifierProvider<AddressProvider>(
        create: (_) => AddressProvider(),
      ),
      ChangeNotifierProvider<OrderProvider>(
        create: (_) => OrderProvider(),
      ),
      // The customer's live rider location (SSE), watched by the order detail
      // screen while an order is out for delivery. Default real opener; the
      // provider tree disposes it.
      ChangeNotifierProvider<LocationProvider>(
        create: (_) => LocationProvider(),
      ),
    ];

class MainApp extends StatelessWidget {
  const MainApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Blynk',
      debugShowCheckedModeBanner: false,
      scaffoldMessengerKey: rootScaffoldMessengerKey,
      onGenerateRoute: AppRouter.generateRoute,
      initialRoute: '/',
      theme: AppTheme.appTHeme,
    );
  }
}
