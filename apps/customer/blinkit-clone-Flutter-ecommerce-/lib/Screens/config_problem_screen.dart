import 'package:flutter/material.dart';

import 'package:ecom/Services/app_config.dart';
import 'package:ecom/UI/Widgets/Atoms/app_state_views.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

/// Shown instead of the app when a release build has no usable server address.
/// It has no action: retrying cannot fix a build. Only the short code is shown,
/// so support can tell which check failed.
class ConfigErrorApp extends StatelessWidget {
  const ConfigErrorApp({super.key, required this.problem});

  final ConfigProblem problem;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Blynk',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.appTHeme,
      home: Scaffold(
        backgroundColor: BlynkColors.paper,
        body: SafeArea(
          child: AppStateView.error(
            title: "This build isn't configured",
            message: 'Install the latest version of Blynk from the store and try again.\n'
                'Code: ${problem.code}',
            onRetry: null,
          ),
        ),
      ),
    );
  }
}
