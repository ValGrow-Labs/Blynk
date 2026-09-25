import 'package:ecom/Services/Validation/app_validators.dart';

// Both delegate to AppValidators so the app has exactly one definition of
// a valid Sri Lankan mobile number, matching the backend's
// normalizeSriLankanPhone (see lib/Services/Validation/app_validators.dart).
bool isValidSriLankanPhone(String? input) => AppValidators.isValidPhone(input);

/// E.164 for the API, or the input unchanged when it isn't a number the
/// backend would accept (the caller validates first).
String formatToE164(String input) => AppValidators.normalizePhone(input) ?? input;

enum RequestingMethods { get, post, put, delete }
