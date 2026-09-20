import 'package:flutter/material.dart';

import '../Services/Location/device_location_source.dart';
import '../Services/Location/geolocator_location_source.dart';
import '../UI/Widgets/Organisms/map_provider.dart';
import '../app_colors.dart';
import '../app_design.dart';

/// "Use my current location" for the address form (plan section 12): explains
/// why the customer's location is wanted, only then asks the OS, reads one
/// position, and lets the customer confirm the exact spot on a map under a
/// fixed pin. Pops the confirmed [GeoPoint], or null when the customer backs
/// out or chooses to enter the location by hand (which stays available in every
/// state).
///
/// This is the customer's own address-entry permission. It is unrelated to
/// watching the rider on the tracking map, which needs no device permission,
/// and the copy says so instead of blurring the two (plan section 12.3).
///
/// Deliberately absent: any distance to the store, delivery-radius hint,
/// reverse geocoding, ETA or route. The server validates the radius at
/// checkout; a client-side hint could drift from it (plan section 12).
///
/// State machine (nothing touches the device until "Allow location"):
///
///   explain --Allow location--> requesting
///   requesting: services off -> servicesOff
///               permission (asked only when still askable):
///                 deniedForever -> deniedForever | denied -> denied
///                 granted -> locating
///   locating:   fix -> ready | DeviceLocationException(reason) ->
///               serviceDisabled -> servicesOff | permissionDenied -> denied |
///               timeout / unavailable / anything else -> error
///   denied / deniedForever / servicesOff / error --Try again--> requesting
///   every state --Enter manually / back--> pop(null); ready --Cancel--> pop(null)
///   ready --Confirm location--> pop(selected)
class LiveLocationPickerScreen extends StatefulWidget {
  const LiveLocationPickerScreen({super.key, this.locationSource, this.mapBuilder});

  /// Test seam: the device location. Production callers leave it null and get
  /// the geolocator-backed source.
  final DeviceLocationSource? locationSource;

  /// Test seam: substitutes the map so widget tests need no native platform
  /// view. Production callers leave it null and get the real map.
  final LocationPickerMapBuilder? mapBuilder;

  @override
  State<LiveLocationPickerScreen> createState() => _LiveLocationPickerScreenState();
}

enum _Phase { explain, requesting, locating, ready, denied, deniedForever, servicesOff, error }

/// "6.438200, 80.027400" - the coordinate the customer is confirming.
String _coordinateLabel(GeoPoint point) =>
    '${point.latitude.toStringAsFixed(6)}, ${point.longitude.toStringAsFixed(6)}';

class _LiveLocationPickerScreenState extends State<LiveLocationPickerScreen> {
  late final DeviceLocationSource _source = widget.locationSource ?? const GeolocatorLocationSource();

  _Phase _phase = _Phase.explain;

  /// The device fix the map is seeded with (never changes after that).
  GeoPoint? _initial;

  /// The coordinate under the pin right now; what Confirm returns.
  GeoPoint? _selected;

  /// Bumped by every attempt so an attempt that finishes after the screen is
  /// gone, or after a newer attempt started, is ignored.
  int _attempt = 0;

  static LocationPickerMapView _defaultMapBuilder({
    required GeoPoint initialPosition,
    required ValueChanged<GeoPoint> onPositionChanged,
  }) =>
      LocationPickerMapView(initialPosition: initialPosition, onPositionChanged: onPositionChanged);

  bool _isCurrent(int attempt) => mounted && attempt == _attempt;

  void _go(int attempt, _Phase phase) {
    if (_isCurrent(attempt)) setState(() => _phase = phase);
  }

  Future<void> _start() async {
    final attempt = ++_attempt;
    setState(() => _phase = _Phase.requesting);
    try {
      if (!await _source.isLocationServiceEnabled()) return _go(attempt, _Phase.servicesOff);
      if (!_isCurrent(attempt)) return;

      var status = await _source.checkPermission();
      if (!_isCurrent(attempt)) return;
      // Only an askable denial is asked (this is the call that shows the OS
      // dialog); a permanent one would show nothing.
      if (status == LocationPermissionStatus.denied) {
        status = await _source.requestPermission();
        if (!_isCurrent(attempt)) return;
      }
      switch (status) {
        case LocationPermissionStatus.deniedForever:
          return _go(attempt, _Phase.deniedForever);
        case LocationPermissionStatus.denied:
          return _go(attempt, _Phase.denied);
        case LocationPermissionStatus.granted:
          break;
      }

      setState(() => _phase = _Phase.locating);
      final fix = await _source.currentPosition();
      if (!_isCurrent(attempt)) return;
      setState(() {
        _initial = fix.position;
        _selected = fix.position;
        _phase = _Phase.ready;
      });
    } on DeviceLocationException catch (e) {
      switch (e.reason) {
        case DeviceLocationFailure.serviceDisabled:
          _go(attempt, _Phase.servicesOff);
        case DeviceLocationFailure.permissionDenied:
          _go(attempt, _Phase.denied);
        case DeviceLocationFailure.timeout:
        case DeviceLocationFailure.unavailable:
          _go(attempt, _Phase.error);
      }
    } catch (_) {
      // A platform error must land in a screen with a way out, never crash.
      _go(attempt, _Phase.error);
    }
  }

  Future<void> _openSettings(Future<bool> Function() open) async {
    try {
      await open();
    } catch (_) {
      // Nothing to add: the customer can still Try again or Enter manually.
    }
  }

  void _enterManually() => Navigator.of(context).pop();

  void _confirm() => Navigator.of(context).pop(_selected);

  @override
  void dispose() {
    _attempt++;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppSurfaces.subtle,
      appBar: AppBar(
        title: const Text('Pin your location'),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0.5,
      ),
      body: SafeArea(child: _body()),
    );
  }

  Widget _body() {
    switch (_phase) {
      case _Phase.explain:
        return _Message(
          key: const Key('picker-explain'),
          icon: Icons.my_location_rounded,
          title: 'Use your current location',
          paragraphs: const [
            'Blynk reads your location once, only to pin your delivery address. '
                'It is never used to track you.',
            "Seeing your rider's live location is separate and does not need this permission.",
          ],
          primaryLabel: 'Allow location',
          onPrimary: _start,
          onManual: _enterManually,
        );
      case _Phase.requesting:
        return const _Progress(key: Key('picker-requesting'), text: 'Waiting for your answer...');
      case _Phase.locating:
        return const _Progress(key: Key('picker-locating'), text: 'Finding your location...');
      case _Phase.denied:
        return _Message(
          key: const Key('picker-denied'),
          icon: Icons.location_disabled_outlined,
          title: 'Location permission is off',
          paragraphs: const [
            "Without it we can't pin your address automatically. You can try again, "
                'or enter your delivery location yourself.',
          ],
          primaryLabel: 'Try again',
          onPrimary: _start,
          onManual: _enterManually,
        );
      case _Phase.deniedForever:
        return _Message(
          key: const Key('picker-denied-forever'),
          icon: Icons.location_disabled_outlined,
          title: 'Location is blocked for Blynk',
          paragraphs: const [
            'Your phone will not ask again. You can allow location for Blynk in '
                'Settings, or enter your delivery location yourself.',
          ],
          primaryLabel: 'Open settings',
          onPrimary: () => _openSettings(_source.openAppSettings),
          secondaryLabel: 'Try again',
          onSecondary: _start,
          onManual: _enterManually,
        );
      case _Phase.servicesOff:
        return _Message(
          key: const Key('picker-services-off'),
          icon: Icons.location_off_outlined,
          title: 'Location services are off',
          paragraphs: const [
            'Turn on location services on your phone to pin your address '
                'automatically, or enter your delivery location yourself.',
          ],
          primaryLabel: 'Open location settings',
          onPrimary: () => _openSettings(_source.openLocationSettings),
          secondaryLabel: 'Try again',
          onSecondary: _start,
          onManual: _enterManually,
        );
      case _Phase.error:
        return _Message(
          key: const Key('picker-error'),
          icon: Icons.error_outline_rounded,
          title: "Couldn't get your location",
          paragraphs: const [
            "Your phone didn't return a position in time. A clearer view of the sky or "
                'a better signal can help. Try again, or enter your delivery location yourself.',
          ],
          primaryLabel: 'Try again',
          onPrimary: _start,
          onManual: _enterManually,
        );
      case _Phase.ready:
        return _Ready(
          key: const Key('picker-ready'),
          initial: _initial!,
          selected: _selected!,
          mapBuilder: widget.mapBuilder ?? _defaultMapBuilder,
          onPositionChanged: (point) => setState(() => _selected = point),
          onConfirm: _confirm,
          onCancel: _enterManually,
        );
    }
  }
}

/// Centred explanation with its actions. Scrolls rather than overflowing on a
/// small screen or a large type scale.
class _Message extends StatelessWidget {
  const _Message({
    super.key,
    required this.icon,
    required this.title,
    required this.paragraphs,
    required this.primaryLabel,
    required this.onPrimary,
    required this.onManual,
    this.secondaryLabel,
    this.onSecondary,
  });

  final IconData icon;
  final String title;
  final List<String> paragraphs;
  final String primaryLabel;
  final VoidCallback onPrimary;
  final String? secondaryLabel;
  final VoidCallback? onSecondary;
  final VoidCallback onManual;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(icon, size: 44, color: AppColors.primaryGreenColor),
              const SizedBox(height: AppSpacing.lg),
              Semantics(
                header: true,
                child: Text(
                  title,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppTextColors.primary),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              for (final paragraph in paragraphs)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: Text(
                    paragraph,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 14, height: 1.4, color: AppTextColors.secondary),
                  ),
                ),
              const SizedBox(height: AppSpacing.lg),
              SizedBox(
                height: 50,
                child: ElevatedButton(onPressed: onPrimary, child: Text(primaryLabel)),
              ),
              if (secondaryLabel != null) ...[
                const SizedBox(height: AppSpacing.sm),
                SizedBox(
                  height: 50,
                  child: OutlinedButton(onPressed: onSecondary, child: Text(secondaryLabel!)),
                ),
              ],
              const SizedBox(height: AppSpacing.sm),
              TextButton(onPressed: onManual, child: const Text('Enter manually')),
            ],
          ),
        ),
      ),
    );
  }
}

class _Progress extends StatelessWidget {
  const _Progress({super.key, required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(color: AppColors.primaryGreenColor),
          const SizedBox(height: AppSpacing.lg),
          Text(text, style: const TextStyle(fontSize: 14, color: AppTextColors.secondary)),
        ],
      ),
    );
  }
}

/// The map under a fixed pin, the live coordinate label, Confirm and Cancel.
class _Ready extends StatelessWidget {
  const _Ready({
    super.key,
    required this.initial,
    required this.selected,
    required this.mapBuilder,
    required this.onPositionChanged,
    required this.onConfirm,
    required this.onCancel,
  });

  final GeoPoint initial;
  final GeoPoint selected;
  final LocationPickerMapBuilder mapBuilder;
  final ValueChanged<GeoPoint> onPositionChanged;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          // Seeded with the first fix only: the map owns the camera after
          // that and reports back through onPositionChanged.
          child: mapBuilder(initialPosition: initial, onPositionChanged: onPositionChanged),
        ),
        DecoratedBox(
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: AppSurfaces.border)),
          ),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'DELIVERY LOCATION',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1,
                    color: AppTextColors.secondary,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                Semantics(
                  liveRegion: true,
                  child: Text(
                    _coordinateLabel(selected),
                    key: const Key('picker-coordinates'),
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppTextColors.primary),
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                const Text(
                  'Move the map to put the pin on your exact delivery spot.',
                  style: TextStyle(fontSize: 12.5, color: AppTextColors.secondary),
                ),
                const SizedBox(height: AppSpacing.md),
                Row(
                  children: [
                    Expanded(
                      child: SizedBox(
                        height: 50,
                        child: OutlinedButton(onPressed: onCancel, child: const Text('Cancel')),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      flex: 2,
                      child: SizedBox(
                        height: 50,
                        child: ElevatedButton(
                          onPressed: onConfirm,
                          child: const FittedBox(child: Text('Confirm location')),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
