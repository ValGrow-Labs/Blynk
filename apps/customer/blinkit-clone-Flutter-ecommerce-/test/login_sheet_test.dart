import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_text_field.dart';
import 'package:ecom/UI/Widgets/Organisms/login_screen_otp_sheet.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';
import 'package:ecom/main.dart' show rootScaffoldMessengerKey;

const _invalidPhoneCopy = 'Enter a valid Sri Lankan mobile number';

class _FailingAuth extends AuthProvider {
  @override
  // The backend's own words are developer text; the sheet shows AppErrors' copy.
  Future<bool> requestOtp(String phone) async =>
      throw ApiException(429, 'Too many attempts. Try again in 43 seconds.', code: 'TOO_MANY_REQUESTS');
}

/// Opens the sheet exactly the way login_screen.dart does.
Future<void> _openSheet(WidgetTester tester, AuthProvider auth, {double textScale = 1}) async {
  tester.view.physicalSize = const Size(400, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        theme: AppTheme.theme,
        scaffoldMessengerKey: rootScaffoldMessengerKey,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => showModalBottomSheet(
                  context: context,
                  backgroundColor: Colors.transparent,
                  isScrollControlled: true,
                  builder: (context) => const LoginwithMobileWidget(),
                ),
                child: const Text('Open login'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open login'));
  await tester.pumpAndSettle();
}

Finder _inSheet(Finder finder) => find.descendant(of: find.byType(LoginwithMobileWidget), matching: finder);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  group('login sheet shows its errors inline (a root SnackBar would sit behind the sheet)', () {
    testWidgets('an invalid phone shows the message inside the sheet, visible, with no SnackBar', (tester) async {
      await _openSheet(tester, AuthProvider());
      expect(find.byType(BottomSheet), findsOneWidget);
      expect(_inSheet(find.text(_invalidPhoneCopy)), findsNothing);

      await tester.enterText(_inSheet(find.byType(TextField)), '123');
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();

      final error = _inSheet(find.text(_invalidPhoneCopy));
      expect(error, findsOneWidget);
      expect(error.hitTestable(), findsOneWidget, reason: 'nothing may cover the message');
      expect(
        tester.getRect(find.byType(BottomSheet)).contains(tester.getCenter(error)),
        isTrue,
        reason: 'the message is drawn within the sheet',
      );
      expect(find.byType(SnackBar), findsNothing);
      expect(_inSheet(find.byIcon(BlynkIcons.error)), findsOneWidget);
    });

    testWidgets('the field gets the 2 dp problem border and the error is a live region', (tester) async {
      final handle = tester.ensureSemantics();
      await _openSheet(tester, AuthProvider());
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();

      final border = tester.widget<TextField>(_inSheet(find.byType(TextField))).decoration!.enabledBorder! as OutlineInputBorder;
      expect(border.borderSide.color, BlynkColors.problem);
      expect(border.borderSide.width, 2);
      expect(tester.getSemantics(_inSheet(find.text(_invalidPhoneCopy))).getSemanticsData().flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('an empty phone is invalid too, same wording', (tester) async {
      await _openSheet(tester, AuthProvider());
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(_inSheet(find.text(_invalidPhoneCopy)), findsOneWidget);
    });

    testWidgets('typing clears the error', (tester) async {
      await _openSheet(tester, AuthProvider());
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(_inSheet(find.text(_invalidPhoneCopy)), findsOneWidget);

      await tester.enterText(_inSheet(find.byType(TextField)), '0771');
      await tester.pump();
      expect(_inSheet(find.text(_invalidPhoneCopy)), findsNothing);
    });

    testWidgets('an OTP request failure shows its message inline in the sheet and stops loading', (tester) async {
      await _openSheet(tester, _FailingAuth());
      await tester.enterText(_inSheet(find.byType(TextField)), '0771234567');
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();

      final error = _inSheet(find.text('Too many tries. Wait a moment, then try again.'));
      expect(error, findsOneWidget);
      expect(find.textContaining('43 seconds'), findsNothing, reason: 'the backend text is not shown');
      expect(error.hitTestable(), findsOneWidget);
      expect(find.byType(SnackBar), findsNothing);
      expect(find.text('Continue'), findsOneWidget, reason: 'the loading spinner is gone and the button is back');
      expect(find.byType(BottomSheet), findsOneWidget);
    });

    testWidgets('the phone field is a BlynkTextField with a visible label, phone keyboard and no forced caps', (tester) async {
      await _openSheet(tester, AuthProvider());
      expect(_inSheet(find.byType(BlynkTextField)), findsOneWidget);
      expect(_inSheet(find.text('Mobile number')), findsOneWidget);
      final field = tester.widget<TextField>(_inSheet(find.byType(TextField)));
      expect(field.keyboardType, TextInputType.phone);
      expect(field.textCapitalization, TextCapitalization.none);
    });

    for (final scale in [1.0, 1.3, 2.0]) {
      testWidgets('no overflow at ${scale}x with the error showing', (tester) async {
        await _openSheet(tester, AuthProvider(), textScale: scale);
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(_inSheet(find.text(_invalidPhoneCopy)), findsOneWidget);
      });
    }
  });
}
