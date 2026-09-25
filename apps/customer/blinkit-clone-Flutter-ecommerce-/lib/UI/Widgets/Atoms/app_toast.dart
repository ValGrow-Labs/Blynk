import 'package:flutter/material.dart';

import '../../../main.dart' show rootScaffoldMessengerKey;
import 'snackbar_helper.dart';

/// Shows a short message from anywhere (no BuildContext needed) as an in-app
/// SnackBar on every platform.
///
/// [backgroundColor] and [textColor] are accepted so existing call sites keep
/// compiling, but they are ignored: the snackbar is always ink on paper and
/// the words carry the meaning. T3 removes them with the call-site cleanup.
///
/// [tone] is the one thing that does change the rendering — it picks the
/// glyph (see [SnackTone]); it never changes the colours.
void showAppToast({
  required String msg,
  Color? backgroundColor,
  Color? textColor,
  SnackTone tone = SnackTone.info,
}) {
  showBlynkSnackBar(messengerKey: rootScaffoldMessengerKey, message: msg, tone: tone);
}
