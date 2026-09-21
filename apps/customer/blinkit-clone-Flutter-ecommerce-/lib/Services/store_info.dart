/// Blynk's single-hub business facts, in one place.
///
/// The backend owns every value here but exposes none of them to the app, so
/// each one mirrors its authority below. A future public `GET /store`
/// (plan B1) replaces this file; nothing else should hard-code these facts.
abstract final class StoreInfo {
  /// The one dark-store hub; also the default city of a new address.
  static const String hubName = 'Dharga Town';

  static const String country = 'Sri Lanka';

  /// Mirrors the delivery window constant in the backend `utils/time.ts`.
  static const String deliveryHoursLabel = '8 AM – 9 PM';

  /// Mirrors `dark_stores.radius_km` (default 4.00).
  static const int serviceRadiusKm = 4;

  /// Mirrors `system_configurations.delivery_fee` (fee_lkr 70). The order's
  /// own `deliveryFee` is authoritative once an order exists.
  static const double flatDeliveryFee = 70.0;

  /// The backend accepts cash on delivery only (`payment_method` is hard-coded COD).
  static const String paymentMethodLabel = 'Cash on delivery';

  /// No customer support channel exists yet (decision D5), so this is
  /// deliberately null: callers must not show a contact line.
  static const String? supportContact = null;
}
