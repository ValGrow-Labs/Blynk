import 'package:flutter/material.dart';

/// The focal point of an uploaded image: the point the operator chose in
/// Blynk Ops that must stay visible when the picture is cropped to fill a
/// fixed shape (backend migration 009).
///
/// ## Why this exists
///
/// Product tiles and the Home carousel draw their image with
/// [BoxFit.cover]: the picture is scaled until it fills the box and whatever
/// does not fit is cropped away. Without an alignment, Flutter crops from the
/// CENTRE — so a banner whose wording runs along the top loses exactly the
/// wording, and a product photographed off-centre loses the product.
///
/// The backend stores two percentages per image. This maps them onto the
/// coordinate space [Alignment] actually uses.
///
/// ## The 50/50 contract
///
/// 50 is the default in the database and the value assumed whenever the API
/// omits the field. 50/50 maps to exactly [Alignment.center], which is what
/// `cover` already did — so every image uploaded before this feature existed
/// renders **identically** to how it renders today. Nothing about the default
/// path changed; only an operator deliberately moving the point changes
/// anything.

/// The centre, as a percentage pair. The default for every image.
const int kFocalCentrePercent = 50;

/// Reads a focal percentage out of a JSON payload.
///
/// **Defaults to 50 when absent, null, unparseable or out of range.** An API
/// response from a backend that predates migration 009 carries no such field
/// at all, and that must not break the app: it simply keeps cropping from the
/// centre, exactly as that older pairing always did.
int parseFocalPercent(Object? value) {
  if (value == null) return kFocalCentrePercent;
  final parsed = value is num ? value.round() : int.tryParse(value.toString().trim());
  if (parsed == null) return kFocalCentrePercent;
  if (parsed < 0 || parsed > 100) return kFocalCentrePercent;
  return parsed;
}

/// Maps a stored 0-100 percentage pair onto Flutter's -1..1 alignment space.
///
/// 0 -> -1 (the left/top edge), 50 -> 0 (the centre), 100 -> 1 (the
/// right/bottom edge). An out-of-range value is clamped rather than allowed
/// to push the image past its own edge.
///
/// 50/50 returns a value equal to [Alignment.center], which is what every
/// `cover` in the app used before this existed.
Alignment focalAlignment(int xPercent, int yPercent) {
  // One division, not a divide-then-subtract: a single correctly-rounded
  // operation lands on exactly the double a written literal would, so
  // `focalAlignment(50, 8)` really does equal `const Alignment(0, -0.84)`
  // rather than missing it by one ulp.
  double axis(int percent) => (percent.clamp(0, 100) - 50) / 50.0;
  return Alignment(axis(xPercent), axis(yPercent));
}
