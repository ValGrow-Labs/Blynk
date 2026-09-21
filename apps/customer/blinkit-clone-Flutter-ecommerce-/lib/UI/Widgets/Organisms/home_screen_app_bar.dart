import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/address.provider.dart';
import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/store_info.dart';
import '../../../app_design.dart';
import '../../../design/tokens.dart';
import '../../../Screens/customer_shell.dart';

/// Home header. Shows where we're delivering to using the customer's real
/// default address.
///
/// This used to show a hardcoded "DELIVERY IN 25 Minutes / HOME- Floor 9,
/// Delhi" - both invented. There is no ETA field anywhere in the backend,
/// so no delivery-time promise is made here; what's shown instead is the
/// real service window and the real saved address (or a prompt to add one).
class HomeScreenAppBar extends StatefulWidget {
  const HomeScreenAppBar({super.key});

  @override
  State<HomeScreenAppBar> createState() => _HomeScreenAppBarState();
}

class _HomeScreenAppBarState extends State<HomeScreenAppBar> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final auth = context.read<AuthProvider>();
      final addresses = context.read<AddressProvider>();
      // Addresses are an authenticated endpoint - don't fire it for a
      // browsing guest and trigger a pointless 401.
      if (auth.isAuthenticated && addresses.addresses.isEmpty) {
        addresses.loadAddresses();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final address = context.watch<AddressProvider>().defaultAddress;
    final isAuthenticated = context.watch<AuthProvider>().isAuthenticated;

    return SliverToBoxAdapter(
      child: SafeArea(
        bottom: false,
        child: Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.sm,
            AppSpacing.sm,
            AppSpacing.sm,
          ),
          child: Row(
            children: [
              Expanded(
                child: InkWell(
                  borderRadius: AppRadius.buttonBorder,
                  // A guest's row is the way to log in; the row is the target.
                  onTap: () => Navigator.of(context)
                      .pushNamed(isAuthenticated ? '/user/address' : '/login'),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 48),
                    child: Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: AppSpacing.xs,
                      horizontal: AppSpacing.xs,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Row(
                          children: [
                            Icon(
                              BlynkIcons.shop,
                              size: 15,
                              color: BlynkColors.ink2,
                            ),
                            SizedBox(width: AppSpacing.xs + 1),
                            Flexible(
                              child: Text(
                              // The real Phase 1 service window, not an ETA.
                              'Delivering ${StoreInfo.deliveryHoursLabel}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              // A service window, not a state, so it is not green.
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 12,
                                color: BlynkColors.ink2,
                              ),
                            ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 1),
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                address?.label ?? StoreInfo.hubName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                  fontSize: 19,
                                  color: AppTextColors.primary,
                                ),
                              ),
                            ),
                            if (isAuthenticated)
                              const Icon(
                                Icons.keyboard_arrow_down_rounded,
                                size: 20,
                                color: AppTextColors.secondary,
                              ),
                          ],
                        ),
                        Text(
                          address?.displaySummary ??
                              (isAuthenticated
                                  ? 'Add a delivery address'
                                  : 'Log in to set your delivery address'),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w400,
                            fontSize: 13,
                            color: AppTextColors.secondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Profile',
                icon: Container(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: const BoxDecoration(
                    color: AppSurfaces.subtle,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.person_outline_rounded,
                    size: 20,
                    color: AppTextColors.primary,
                  ),
                ),
                onPressed: () => CustomerShell.selectTab(context, 3),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
