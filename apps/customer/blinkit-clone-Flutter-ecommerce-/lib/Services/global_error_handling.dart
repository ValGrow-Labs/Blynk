import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../UI/Widgets/Atoms/app_state_views.dart';
import '../app_theme.dart';
import '../design/tokens.dart';

/// What the app does with an error nobody caught. No third-party SDK: it is
/// logged, and in a release build the customer sees a plain fallback in place
/// of Flutter's red/grey error box.
///
/// [install] returns a function that puts the previous handlers back, so a
/// test can install it without leaking into the next one.
class GlobalErrorHandling {
  const GlobalErrorHandling._();

  static VoidCallback install({
    required GlobalKey<NavigatorState> navigatorKey,
    bool isRelease = kReleaseMode,
    void Function(String line)? log,
  }) {
    final write = log ?? (String line) => debugPrint(line);
    final previousOnError = FlutterError.onError;
    final previousPlatformOnError = PlatformDispatcher.instance.onError;
    final previousBuilder = ErrorWidget.builder;

    FlutterError.onError = (FlutterErrorDetails details) {
      if (isRelease) {
        // Type and place only: the message can carry a customer's own data.
        write('FlutterError ${details.exception.runtimeType} in ${details.library ?? 'app'}');
      } else {
        write('FlutterError: ${details.exceptionAsString()}');
        FlutterError.presentError(details);
      }
    };

    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      write(isRelease ? 'Unhandled ${error.runtimeType}' : 'Unhandled $error\n$stack');
      return true; // handled: nothing more to do than log it
    };

    if (isRelease) {
      ErrorWidget.builder = (FlutterErrorDetails details) => ReleaseErrorFallback(
            onReload: () => navigatorKey.currentState
                ?.pushNamedAndRemoveUntil('/home', (route) => false),
          );
    }
    // Debug keeps Flutter's own error widget: the red box is how a developer
    // finds the bug.

    return () {
      FlutterError.onError = previousOnError;
      PlatformDispatcher.instance.onError = previousPlatformOnError;
      ErrorWidget.builder = previousBuilder;
    };
  }
}

/// Shown in place of a widget that threw while building (release only). It
/// brings its own theme, direction and surface because the widget that failed
/// may have been above any of them.
class ReleaseErrorFallback extends StatelessWidget {
  const ReleaseErrorFallback({super.key, required this.onReload});

  final VoidCallback onReload;

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Theme(
        data: AppTheme.appTHeme,
        child: Material(
          color: BlynkColors.paper,
          child: AppStateView.error(
            title: 'Something went wrong',
            message: 'Go back to the shop and try again.',
            retryLabel: 'Go to Shop',
            onRetry: onReload,
          ),
        ),
      ),
    );
  }
}
