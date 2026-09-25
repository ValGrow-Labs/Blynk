import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/dental_doctor_model.dart';
import '../Models/dental_format.dart';
import '../Services/Providers/dental.provider.dart';
import '../Services/app_errors.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/app_toast.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Organisms/dental_widgets.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';
import 'dental_patient_details_screen.dart';

/// Step 1 of the booking flow (task F3): pick a date, then a time, then hold
/// it. `doctorId`/`clinicId` is all this screen is given (F2's `/dental/book`
/// argument shape - see task-F2-report.md) - the one clinic-doctor pairing
/// (and its `clinic_doctor_id`, the id `holdSlot` actually needs) is resolved
/// here via `fetchDoctorDetail`, the same `clinics[]` lookup
/// `DentalDoctorProfileScreen._pairing` already does.
class DentalSlotPickerScreen extends StatefulWidget {
  const DentalSlotPickerScreen({super.key, required this.doctorId, required this.clinicId});

  final String doctorId;
  final String clinicId;

  @override
  State<DentalSlotPickerScreen> createState() => _DentalSlotPickerScreenState();
}

class _DentalSlotPickerScreenState extends State<DentalSlotPickerScreen> {
  /// The date strip's width: 7-14 days (plan §11), well under the backend's
  /// 30-day `/availability` range cap (task-B2-report.md) - a wider window is
  /// never even requested.
  static const int _dayStripLength = 14;

  DoctorModel? _doctor;
  DoctorClinicModel? _pairing;
  bool _loading = true;
  CustomerError? _failure;

  List<DateTime> _days = const [];
  List<DateAvailability> _availability = const [];
  DateTime? _selectedDate;

  List<DateTime> _slots = const [];
  bool _slotsLoading = false;
  CustomerError? _slotsFailure;

  /// The inline "just booked" / "time passed" notice (brief: never a silent
  /// retry, never an auto-picked nearby slot - just tell the customer and
  /// refresh the list).
  String? _holdMessage;

  /// The slot mid-hold-request, so its chip shows a spinner and every other
  /// chip disables rather than allowing a second hold to race the first.
  DateTime? _holdingSlot;

  /// This screen's own route, captured once dependencies are ready. Lets a
  /// deep child (the review screen, after a 410/409 on confirm) pop straight
  /// back here by route identity - robust to however many steps are pushed
  /// on top, and to whatever name (or no name) this route was reached with.
  Route<dynamic>? _ownRoute;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _ownRoute = ModalRoute.of(context);
  }

  static DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

  static String _isoDate(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  bool _hasAvailability(DateTime day) {
    final iso = _isoDate(day);
    for (final a in _availability) {
      if (a.date == iso) return a.hasAvailability;
    }
    // No entry at all for this date (shouldn't happen inside the requested
    // range) reads as "nothing known to be open" rather than a fabricated yes.
    return false;
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _failure = null;
    });
    final provider = context.read<DentalProvider>();
    try {
      final doctor = await provider.fetchDoctorDetail(widget.doctorId);
      DoctorClinicModel? pairing;
      for (final c in doctor.clinics) {
        if (c.clinicId == widget.clinicId) {
          pairing = c;
          break;
        }
      }
      if (pairing == null) {
        if (!mounted) return;
        setState(() {
          _failure = AppErrors.notFound;
          _loading = false;
        });
        return;
      }
      final today = _dateOnly(provider.now);
      final days = List.generate(_dayStripLength, (i) => today.add(Duration(days: i)));
      final availability = await provider.fetchDoctorAvailability(
        doctorId: widget.doctorId,
        clinicId: widget.clinicId,
        from: days.first,
        to: days.last,
      );
      if (!mounted) return;
      setState(() {
        _doctor = doctor;
        _pairing = pairing;
        _days = days;
        _availability = availability;
        _selectedDate = days.first;
        _loading = false;
      });
      await _loadSlots();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _failure = AppErrors.from(e);
        _loading = false;
      });
    }
  }

  Future<void> _loadSlots() async {
    final date = _selectedDate;
    if (date == null || !mounted) return;
    setState(() {
      _slotsLoading = true;
      _slotsFailure = null;
    });
    try {
      // Never cached (task-F1-report.md: "slot lists can legitimately shrink
      // between calls") - always a fresh request, even on a re-select of the
      // same date.
      final slots = await context.read<DentalProvider>().fetchDoctorSlots(
            doctorId: widget.doctorId,
            clinicId: widget.clinicId,
            date: date,
          );
      if (!mounted) return;
      setState(() {
        _slots = slots;
        _slotsLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _slotsFailure = AppErrors.from(e);
        _slotsLoading = false;
      });
    }
  }

  void _selectDate(DateTime day) {
    if (_selectedDate != null && _sameDay(day, _selectedDate!)) return;
    setState(() {
      _selectedDate = day;
      _slots = const [];
      _holdMessage = null;
    });
    _loadSlots();
  }

  Future<void> _holdSlot(DateTime slot) async {
    final pairing = _pairing;
    final doctor = _doctor;
    if (pairing == null || doctor == null || _holdingSlot != null) return;

    setState(() {
      _holdingSlot = slot;
      _holdMessage = null;
    });

    final outcome = await context.read<DentalProvider>().holdSlot(
          clinicDoctorId: pairing.clinicDoctorId,
          startAt: slot,
        );
    if (!mounted) return;

    if (outcome.ok) {
      setState(() => _holdingSlot = null);
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => DentalPatientDetailsScreen(
            hold: outcome.appointment!,
            doctor: doctor,
            pairing: pairing,
            onExpired: _returnFromExpiredHold,
          ),
        ),
      );
      // Whatever happened downstream (booked, backed out, or bounced back
      // after an expiry), this list may now be stale - refresh it.
      if (mounted) await _loadSlots();
      return;
    }

    setState(() {
      _holdingSlot = null;
      if (outcome.isSlotConflict) {
        _holdMessage = 'This time was just booked by someone else.';
      } else if (outcome.isSlotInPast) {
        _holdMessage = 'This time has passed. Pick another slot.';
      }
    });

    if (outcome.isSlotConflict || outcome.isSlotInPast) {
      // Never a silent retry, never an auto-picked nearby slot - just refresh.
      await _loadSlots();
    } else {
      showAppToast(msg: AppErrors.from(outcome.error).message);
    }
  }

  /// Passed all the way down to the review screen: "pick a new time" after a
  /// hold expired pops back to THIS still-mounted screen (by route identity,
  /// not by name or a fixed pop count) and refreshes its slot list.
  void _returnFromExpiredHold() {
    final route = _ownRoute;
    if (route != null) {
      Navigator.of(context).popUntil((r) => identical(r, route));
    }
    _loadSlots();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: Text(_doctor?.fullName ?? 'Book appointment')),
      body: ContentFrame(gutter: false, child: _body()),
    );
  }

  Widget _body() {
    if (_loading) {
      return SkeletonScope(
        child: ListView(
          key: const Key('slot-picker-skeleton'),
          padding: const EdgeInsets.all(BlynkSpace.s16),
          children: const [
            AppSkeleton(height: 64),
            SizedBox(height: BlynkSpace.s24),
            AppSkeleton(height: 40, width: 160),
            SizedBox(height: BlynkSpace.s16),
            AppSkeleton(height: 40),
          ],
        ),
      );
    }

    final failure = _failure;
    if (failure != null) {
      if (failure.isNotFound) {
        return AppStateView.notFound(
          title: 'Doctor not available',
          message: "This doctor isn't taking bookings at this clinic anymore.",
          actionLabel: 'Go back',
          onAction: () => Navigator.of(context).maybePop(),
        );
      }
      return FailureState(
        failure: failure,
        title: "We couldn't load booking details",
        scrollable: false,
        onRetry: _load,
        retryKey: const Key('slot-picker-retry'),
      );
    }

    final selected = _selectedDate!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Sections are separated by space, not rules - the strip used to sit
        // above a 1 px Divider.
        const Padding(
          padding: EdgeInsets.fromLTRB(BlynkSpace.s16, BlynkSpace.s16, BlynkSpace.s16, 0),
          child: DentalSectionTitle('Pick a day'),
        ),
        _DateStrip(
          days: _days,
          selected: selected,
          hasAvailability: _hasAvailability,
          onSelect: _selectDate,
        ),
        if (_holdMessage != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, BlynkSpace.s8, BlynkSpace.s16, 0),
            child: Semantics(
              liveRegion: true,
              container: true,
              child: DecoratedBox(
                key: const Key('hold-message'),
                decoration: const BoxDecoration(
                  color: BlynkColors.noticeTint,
                  borderRadius: BlynkRadius.mdAll,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(BlynkSpace.s12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(BlynkIcons.info, size: BlynkIcons.xs, color: BlynkColors.notice),
                      const SizedBox(width: BlynkSpace.s8),
                      Expanded(
                        child: Text(
                          _holdMessage!,
                          style: BlynkText.body.copyWith(color: BlynkColors.notice),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        Expanded(child: _slotsBody(selected)),
      ],
    );
  }

  Widget _slotsBody(DateTime selected) {
    if (_slotsLoading) {
      return SkeletonScope(
        child: Padding(
          key: const Key('slots-skeleton'),
          padding: const EdgeInsets.all(BlynkSpace.s16),
          child: Wrap(
            spacing: BlynkSpace.s8,
            runSpacing: BlynkSpace.s8,
            children: List.generate(
              6,
              (_) => const AppSkeleton(width: 84, height: 48, radius: BlynkRadius.md),
            ),
          ),
        ),
      );
    }

    final failure = _slotsFailure;
    if (failure != null) {
      return FailureState(
        failure: failure,
        title: "We couldn't load times for this day",
        onRetry: _loadSlots,
        retryKey: const Key('slots-retry'),
      );
    }

    if (_slots.isEmpty) {
      // The real reason, from the backend's own availability answer for this
      // day - never a hidden or silently skipped day.
      return const AppStateView.empty(
        title: 'Fully booked',
        message: 'Try another day.',
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, BlynkSpace.s16, BlynkSpace.s16, BlynkSpace.s32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          DentalSectionTitle('Times on ${formatAppointmentDate(selected)}'),
          const SizedBox(height: BlynkSpace.s12),
          Wrap(
            spacing: BlynkSpace.s8,
            runSpacing: BlynkSpace.s8,
            children: [
              for (final slot in _slots)
                _SlotChip(
                  slot: slot,
                  holding: _holdingSlot == slot,
                  disabled: _holdingSlot != null,
                  onTap: () => _holdSlot(slot),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DateStrip extends StatelessWidget {
  const _DateStrip({
    required this.days,
    required this.selected,
    required this.hasAvailability,
    required this.onSelect,
  });

  final List<DateTime> days;
  final DateTime selected;
  final bool Function(DateTime) hasAvailability;
  final ValueChanged<DateTime> onSelect;

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  @override
  Widget build(BuildContext context) {
    // A Row inside a horizontal scroller rather than a fixed-height
    // ListView: the strip is 14 chips, so nothing is gained by lazy building,
    // and the height then follows the type scale instead of a hardcoded box
    // that clips the disabled chips' reason line at 1.3x / 2.0x.
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s16, vertical: BlynkSpace.s8),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var index = 0; index < days.length; index++) ...[
              if (index > 0) const SizedBox(width: BlynkSpace.s8),
              _DayChip(
                key: Key('day-chip-${days[index].year}-${days[index].month}-${days[index].day}'),
                day: days[index],
                available: hasAvailability(days[index]),
                selected: _sameDay(days[index], selected),
                onTap: hasAvailability(days[index]) ? () => onSelect(days[index]) : null,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// One day in the strip. Available = `paper` with a `line-strong` boundary,
/// selected = a filled `signal` tile, unavailable = disabled **with the real
/// reason printed on the chip** ("No times"), never hidden from the strip.
class _DayChip extends StatelessWidget {
  const _DayChip({super.key, required this.day, required this.available, required this.selected, this.onTap});

  final DateTime day;
  final bool available;
  final bool selected;
  final VoidCallback? onTap;

  /// Wide enough that a two-word label still reads as one tile, and never
  /// under the 48 dp target.
  static const double minWidth = 56;

  @override
  Widget build(BuildContext context) {
    final label = formatDayStripLabel(day);
    final fg = !available
        ? BlynkColors.ink3
        : selected
            ? BlynkColors.onSignal
            : BlynkColors.ink;

    return Semantics(
      button: true,
      enabled: available,
      selected: selected,
      label: available ? label : '$label, no times available',
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        borderRadius: BlynkRadius.mdAll,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minWidth: minWidth),
            padding: const EdgeInsets.symmetric(
              horizontal: BlynkSpace.s12,
              vertical: BlynkSpace.s12,
            ),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: selected ? BlynkColors.signal : BlynkColors.paper,
              borderRadius: BlynkRadius.mdAll,
              border: Border.all(
                color: selected
                    ? BlynkColors.signal
                    : available
                        ? BlynkColors.lineStrong
                        : BlynkColors.line,
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  label,
                  textAlign: TextAlign.center,
                  style: BlynkText.caption.copyWith(color: fg, fontWeight: FontWeight.w700),
                ),
                if (!available)
                  Text(
                    'No times',
                    textAlign: TextAlign.center,
                    style: BlynkText.caption.copyWith(color: BlynkColors.ink3),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One bookable time. Available = `paper` with a `line-strong` boundary;
/// the one being held right now = a filled `signal` tile (the selected
/// state); every other chip during that request = genuinely disabled, with
/// the reason spoken ("another time is being reserved") rather than the chip
/// simply going quiet.
class _SlotChip extends StatelessWidget {
  const _SlotChip({required this.slot, required this.holding, required this.disabled, required this.onTap});

  final DateTime slot;
  final bool holding;
  final bool disabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final label = formatSlotTime(slot);
    final enabled = !disabled;
    final fg = holding
        ? BlynkColors.onSignal
        : enabled
            ? BlynkColors.ink
            : BlynkColors.ink3;

    return Semantics(
      button: true,
      enabled: enabled,
      selected: holding,
      label: holding
          ? '$label, reserving'
          : enabled
              ? label
              : '$label, unavailable while another time is being reserved',
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        borderRadius: BlynkRadius.mdAll,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: Key('slot-chip-${slot.toIso8601String()}'),
          onTap: disabled ? null : onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
            padding: const EdgeInsets.symmetric(
              horizontal: BlynkSpace.s16,
              vertical: BlynkSpace.s12,
            ),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: holding ? BlynkColors.signal : BlynkColors.paper,
              borderRadius: BlynkRadius.mdAll,
              border: Border.all(
                color: holding
                    ? BlynkColors.signal
                    : enabled
                        ? BlynkColors.lineStrong
                        : BlynkColors.line,
              ),
            ),
            child: holding
                ? const SizedBox(
                    width: BlynkControl.spinnerCompact,
                    height: BlynkControl.spinnerCompact,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(BlynkColors.onSignal),
                    ),
                  )
                : Text(
                    label,
                    style: BlynkText.body.copyWith(color: fg, fontWeight: FontWeight.w700),
                  ),
          ),
        ),
      ),
    );
  }
}
