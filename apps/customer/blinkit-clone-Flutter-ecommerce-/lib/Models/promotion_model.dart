import 'package:flutter/material.dart';

import 'image_focal.dart';

/// A Home carousel promotion, exactly as the backend returns it from
/// GET /api/v1/promotions (active promotions, in display order).
///
/// The app owns none of this content: titles, visuals, button labels and
/// ordering are all set by the Admin app and stored in PostgreSQL.
class PromotionModel {
  final String id;
  final String title;
  final String? subtitle;
  final String? imageUrl;

  /// How the card is filled behind the content: 'SOLID', 'GRADIENT',
  /// 'IMAGE' or 'ARTWORK'. Set in the Blynk Ops app - the customer app
  /// renders it and chooses nothing itself.
  ///
  /// This is a plain string rather than an enum on purpose: the backend may
  /// gain a type this build has never heard of, and a promotion is not worth
  /// a crash. An unrecognised value falls through every `has*` getter below
  /// and the carousel paints [backgroundColor] flat (or its neutral surface),
  /// with the headline and subtitle still drawn - the same graceful result a
  /// SOLID promotion with no stored colour already gets.
  final String backgroundType;
  final String? backgroundColor;
  final String? backgroundColorEnd;
  final String? backgroundImageUrl;

  /// Where the card's crop anchors on [backgroundImageUrl], as a percentage
  /// of that image's own width and height (backend migration 009).
  ///
  /// The card is a fixed shape filled with [BoxFit.cover], so the part that
  /// does not fit is cropped - from the centre, until the operator says
  /// otherwise. A banner whose headline runs along the top used to lose the
  /// headline. Applies to IMAGE and ARTWORK alike, because both draw the same
  /// file. **50/50 is the centre** and is the value used whenever the API
  /// omits these fields. See [backgroundAlignment].
  final int backgroundFocalX;
  final int backgroundFocalY;

  final String? ctaLabel;

  /// 'CATEGORY', 'PRODUCT', 'CATALOG', or null for an informational
  /// promotion with nothing to open.
  final String? ctaDestinationType;

  /// A category slug or a product id, depending on the type above.
  final String? ctaDestinationValue;

  final int displayOrder;

  const PromotionModel({
    required this.id,
    required this.title,
    this.subtitle,
    this.imageUrl,
    this.backgroundType = 'SOLID',
    this.backgroundColor,
    this.backgroundColorEnd,
    this.backgroundImageUrl,
    this.backgroundFocalX = kFocalCentrePercent,
    this.backgroundFocalY = kFocalCentrePercent,
    this.ctaLabel,
    this.ctaDestinationType,
    this.ctaDestinationValue,
    this.displayOrder = 0,
  });

  factory PromotionModel.fromJson(Map<String, dynamic> json) {
    String? text(Object? value) {
      final result = value?.toString().trim();
      return (result == null || result.isEmpty) ? null : result;
    }

    return PromotionModel(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      subtitle: text(json['subtitle']),
      imageUrl: text(json['image_url'] ?? json['imageUrl']),
      backgroundType:
          text(json['background_type'] ?? json['backgroundType'])?.toUpperCase() ??
              'SOLID',
      backgroundColor: text(json['background_color'] ?? json['backgroundColor']),
      backgroundColorEnd:
          text(json['background_color_end'] ?? json['backgroundColorEnd']),
      backgroundImageUrl:
          text(json['background_image_url'] ?? json['backgroundImageUrl']),
      // Absent, null or unparseable all mean the centre - the crop this app
      // already performed before migration 009 existed.
      backgroundFocalX:
          parseFocalPercent(json['background_focal_x'] ?? json['backgroundFocalX']),
      backgroundFocalY:
          parseFocalPercent(json['background_focal_y'] ?? json['backgroundFocalY']),
      ctaLabel: text(json['cta_label'] ?? json['ctaLabel']),
      ctaDestinationType:
          text(json['cta_destination_type'] ?? json['ctaDestinationType'])
              ?.toUpperCase(),
      ctaDestinationValue:
          text(json['cta_destination_value'] ?? json['ctaDestinationValue']),
      displayOrder: int.tryParse(
            (json['display_order'] ?? json['displayOrder'] ?? 0).toString(),
          ) ??
          0,
    );
  }

  /// Parses a stored hex colour (#RGB, #RRGGBB, #RRGGBBAA) into a Color, or
  /// null when the value is missing or malformed - the carousel then falls
  /// back to its neutral surface rather than rendering something broken.
  static Color? parseHexColor(String? value) {
    if (value == null) return null;
    var hex = value.trim().replaceFirst('#', '');
    if (hex.length == 3) {
      hex = hex.split('').map((c) => '$c$c').join();
    }
    if (hex.length == 6) hex = 'FF$hex';
    if (hex.length != 8) return null;
    final parsed = int.tryParse(hex, radix: 16);
    return parsed == null ? null : Color(parsed);
  }

  /// The stored focal point as a Flutter [Alignment], ready to hand to the
  /// card's `cover` image. [Alignment.center] for every promotion that has
  /// never had one set, which is every promotion stored before 009.
  Alignment get backgroundAlignment =>
      focalAlignment(backgroundFocalX, backgroundFocalY);

  Color? get backgroundStart => parseHexColor(backgroundColor);
  Color? get backgroundEnd => parseHexColor(backgroundColorEnd);

  /// True when the stored background is actually renderable.
  bool get hasGradient =>
      backgroundType == 'GRADIENT' &&
      backgroundStart != null &&
      backgroundEnd != null;

  bool get hasBackgroundImage =>
      backgroundType == 'IMAGE' && backgroundImageUrl != null;

  /// A finished banner the operator uploaded as-is: it fills the whole card,
  /// with no scrim, headline or subtitle drawn over it, because the artwork
  /// already carries its own wording.
  ///
  /// [title] is still required and is still used - as the slide's semantic
  /// label. With the words baked into a picture it is the only thing a
  /// screen-reader user has to go on.
  bool get hasArtwork =>
      backgroundType == 'ARTWORK' && backgroundImageUrl != null;

  /// A destination the app can actually open, regardless of whether there is
  /// a button label for it.
  bool get hasDestination =>
      ctaDestinationType == 'CATALOG' ||
      (ctaDestinationType == 'CATEGORY' && ctaDestinationValue != null) ||
      (ctaDestinationType == 'PRODUCT' && ctaDestinationValue != null);

  /// A promotion only shows a button when the backend gave it a label and a
  /// destination the app can actually open - nothing is invented here.
  bool get hasAction => ctaLabel != null && hasDestination;

  /// An ARTWORK banner with somewhere to go but no button label: the operator
  /// drew the call to action into the artwork, so the card itself is the tap
  /// target rather than a pill stamped over their design. Only ARTWORK does
  /// this - every other type keeps its button.
  bool get isTappableCard => hasArtwork && ctaLabel == null && hasDestination;
}
