import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Screens/Auth/otp_verification_screen.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/app_theme.dart';

const _devChip = 'Dev Code: 482913 (auto-filled)';

/// An auth that already holds the dev code the API returned (debug backend).
Future<AuthProvider> _authWithDevCode() async {
  final auth = AuthProvider(
    request: ({methodType, url, body}) async => {
      'success': true,
      'data': {'dev_otp': '482913'},
    },
  );
  await auth.requestOtp('0771234567');
  return auth;
}

Future<void> _pump(WidgetTester tester, AuthProvider auth, {bool? isDebug}) async {
  tester.view.physicalSize = const Size(400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        theme: AppTheme.theme,
        home: OTPVerificationScreen(data: '0771234567', isDebug: isDebug),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

String _fieldText(WidgetTester tester) => tester.widget<EditableText>(find.byType(EditableText)).controller.text;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // A widget test can end with a storage call unfinished; do not let it block the next test.
  setUp(() {
    TokenStorage.resetSerialQueueForTest();
    FlutterSecureStorage.setMockInitialValues({});
  });
  tearDown(TokenStorage.resetSerialQueueForTest);

  testWidgets('debug build with a dev_otp: the chip shows and the code is auto-filled', (tester) async {
    final auth = await _authWithDevCode();
    expect(auth.lastDevOtp, '482913');

    await _pump(tester, auth, isDebug: true);

    expect(find.text(_devChip), findsOneWidget);
    expect(_fieldText(tester), '482913');
    await tester.pumpWidget(const SizedBox());
    auth.dispose();
  });

  testWidgets('release build: dev_otp is ignored even though the API sent it', (tester) async {
    final auth = await _authWithDevCode();
    expect(auth.lastDevOtp, '482913', reason: 'the field is present in the response');

    await _pump(tester, auth, isDebug: false);

    expect(find.textContaining('Dev Code'), findsNothing);
    expect(find.textContaining('482913'), findsNothing);
    expect(_fieldText(tester), isEmpty);
    await tester.pumpWidget(const SizedBox());
    auth.dispose();
  });

  testWidgets('release build: the resent code is not auto-filled either', (tester) async {
    final auth = await _authWithDevCode();
    await _pump(tester, auth, isDebug: false);

    await tester.pump(const Duration(seconds: 31)); // the resend countdown ends
    await tester.tap(find.text('Resend OTP'));
    await tester.pump();
    await tester.pump();

    expect(_fieldText(tester), isEmpty);
    expect(find.textContaining('Dev Code'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    auth.dispose();
  });

  testWidgets('debug build without a dev_otp: no chip and nothing filled', (tester) async {
    final auth = AuthProvider(request: ({methodType, url, body}) async => {'success': true, 'data': {}});
    await auth.requestOtp('0771234567');

    await _pump(tester, auth, isDebug: true);

    expect(find.textContaining('Dev Code'), findsNothing);
    expect(_fieldText(tester), isEmpty);
    await tester.pumpWidget(const SizedBox());
    auth.dispose();
  });

  testWidgets('with no override the screen follows the build mode (this runner is a debug build)', (tester) async {
    final auth = await _authWithDevCode();

    await _pump(tester, auth);

    expect(find.text(_devChip), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    auth.dispose();
  });

  test('the provider itself only keeps the dev code in a debug build', () {
    final source = File('lib/Services/Providers/auth.provider.dart').readAsStringSync();
    expect(source, contains('kDebugMode ? response'));
  });

  group('status bar', () {
    test('the screen source no longer sets the overlay style in build', () {
      final source = File('lib/Screens/Auth/otp_verification_screen.dart').readAsStringSync();
      expect(source, isNot(contains('setSystemUIOverlayStyle')));
      expect(source, isNot(contains('SystemUiOverlayStyle')));
    });
  });
}
