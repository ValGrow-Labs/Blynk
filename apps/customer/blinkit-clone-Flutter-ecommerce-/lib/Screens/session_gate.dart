import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Screens/Auth/login_screen.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/app_session_cleaner.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_logo.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_spinner.dart';
import 'package:ecom/UI/Widgets/Atoms/snackbar_helper.dart';
import 'package:ecom/design/tokens.dart';

/// The message shown after a login the server no longer accepts.
const String kSessionEndedMessage = "You've been logged out. Log in again to see your orders.";

/// The app's start route. Local-first: whether a customer is signed in is
/// decided from what is stored on the device, so a returning customer goes
/// straight to the shop with no network wait and no glimpse of the login
/// screen; the session is re-checked in the background by [AuthProvider]. A
/// guest sees the login screen (with its Skip).
class SessionGate extends StatefulWidget {
  const SessionGate({super.key});

  @override
  State<SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<SessionGate> {
  bool _showLogin = false;

  @override
  void initState() {
    super.initState();
    unawaited(_decide());
  }

  Future<void> _decide() async {
    final signedIn = await context.read<AuthProvider>().restoreSession();
    if (!mounted) return;
    if (signedIn) {
      unawaited(Navigator.of(context).pushReplacementNamed('/home'));
    } else {
      setState(() => _showLogin = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_showLogin) return const LoginScreen();
    return const Scaffold(
      backgroundColor: BlynkColors.paper,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            BlynkLogo(height: 48),
            SizedBox(height: BlynkSpace.s32),
            BlynkSpinner(size: 28, strokeWidth: 3),
          ],
        ),
      ),
    );
  }
}

/// Wired once, above the navigator. When the server rejects the login (the
/// HTTP layer or [AuthProvider] reports it) this forgets the customer's data,
/// returns to the login screen and says so in plain words. A logout the
/// customer chose is handled by the logout dialog, not here.
class SessionEndListener extends StatefulWidget {
  const SessionEndListener({
    super.key,
    required this.navigatorKey,
    required this.messengerKey,
    required this.child,
  });

  final GlobalKey<NavigatorState> navigatorKey;
  final GlobalKey<ScaffoldMessengerState> messengerKey;
  final Widget child;

  @override
  State<SessionEndListener> createState() => _SessionEndListenerState();
}

class _SessionEndListenerState extends State<SessionEndListener> {
  StreamSubscription<void>? _rejectedSub;
  StreamSubscription<SessionEndReason>? _endedSub;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthProvider>();
    _rejectedSub = ApiService.sessionRejected.listen((_) => auth.endSession());
    _endedSub = auth.onSessionEnded.listen((_) => _onSessionEnded());
  }

  @override
  void dispose() {
    _rejectedSub?.cancel();
    _endedSub?.cancel();
    super.dispose();
  }

  void _onSessionEnded() {
    if (!mounted) return;
    AppSessionCleaner.clearUserScopedState(context);
    widget.navigatorKey.currentState?.pushNamedAndRemoveUntil('/login', (_) => false);
    showBlynkSnackBar(messengerKey: widget.messengerKey, message: kSessionEndedMessage);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
