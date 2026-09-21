import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/connectivity_hint.dart';
import 'offline_banner.dart';

/// The [OfflineBanner] while the last network call failed for lack of a
/// connection and the screen is showing saved content ([hasContent]).
///
/// It listens to the [ConnectivityHint] itself and shows nothing when the app
/// has none in its provider tree, so a screen can carry it without every host
/// having to provide one.
class ConnectivityBanner extends StatefulWidget {
  const ConnectivityBanner({super.key, required this.hasContent, this.onRetry});

  /// True when saved content (products, results, a cart) is on screen. With
  /// nothing to show, the screen's own offline state speaks instead.
  final bool hasContent;
  final VoidCallback? onRetry;

  @override
  State<ConnectivityBanner> createState() => _ConnectivityBannerState();
}

class _ConnectivityBannerState extends State<ConnectivityBanner> {
  ConnectivityHint? _hint;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    ConnectivityHint? next;
    try {
      next = Provider.of<ConnectivityHint>(context, listen: false);
    } on ProviderNotFoundException {
      next = null;
    }
    if (!identical(next, _hint)) {
      _hint?.removeListener(_changed);
      _hint = next;
      next?.addListener(_changed);
    }
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _hint?.removeListener(_changed);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final offline = _hint?.isOffline ?? false;
    if (!offline || !widget.hasContent) return const SizedBox.shrink();
    return OfflineBanner(onRetry: widget.onRetry);
  }
}
