import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../Services/store_info.dart';
import '../design/tokens.dart';

class AppAboutScreen extends StatefulWidget {
  const AppAboutScreen({super.key});

  @override
  State<AppAboutScreen> createState() => _AppAboutScreenState();
}

class _AppAboutScreenState extends State<AppAboutScreen> {
  late final Future<PackageInfo> _packageInfo = PackageInfo.fromPlatform();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('About us'),
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(
          horizontal: BlynkSpace.s16,
          vertical: BlynkSpace.s16,
        ),
        children: [
          const Text('Blynk', style: BlynkText.title),
          FutureBuilder<PackageInfo>(
            future: _packageInfo,
            builder: (context, snapshot) {
              final info = snapshot.data;
              // Nothing while loading, and nothing (rather than a made-up
              // number) if the platform cannot report a version.
              if (info == null) return const SizedBox.shrink();
              final build =
                  info.buildNumber.isEmpty ? '' : ' (${info.buildNumber})';
              return Text(
                'Version ${info.version}$build',
                style: BlynkText.body.copyWith(color: BlynkColors.ink2),
              );
            },
          ),
          const SizedBox(height: BlynkSpace.s16),
          const Text(
            'Blynk delivers groceries from a local store in '
            '${StoreInfo.hubName}. You place the order in the app and pay '
            'in cash when it arrives. Deliveries go out '
            '${StoreInfo.deliveryHoursLabel}.',
            style: BlynkText.body,
          ),
        ],
      ),
    );
  }
}
