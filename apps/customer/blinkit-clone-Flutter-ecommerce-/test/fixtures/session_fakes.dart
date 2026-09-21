import 'package:ecom/Models/user_model.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';

/// A signed-in customer with no network: `isAuthenticated` is true and the
/// profile is fixed, so screens that gate on the session can be pumped alone.
class SignedInAuth extends AuthProvider {
  SignedInAuth({super.request});

  @override
  bool get isAuthenticated => true;

  @override
  UserModel? get currentUser => UserModel.fromJson(const {
        'id': 'u1',
        'phone': '+94771234567',
        'role': 'CUSTOMER',
        'full_name': 'Nimal Perera',
      });
}
