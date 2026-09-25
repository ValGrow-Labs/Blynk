import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/card_add_address.dart';
import '../UI/Widgets/Atoms/card_address_screen.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../Services/Providers/address.provider.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

class UserAddressScreen extends StatefulWidget {
  const UserAddressScreen({super.key});

  @override
  State<UserAddressScreen> createState() => _UserAddressScreenState();
}

class _UserAddressScreenState extends State<UserAddressScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AddressProvider>().loadAddresses();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(
        title: const Text('My Addresses'),
      ),
      body: ContentFrame(
        maxWidth: 720,
        gutter: false,
        child: Consumer<AddressProvider>(
          builder: (context, addressProvider, _) {
            return RefreshIndicator(
              onRefresh: addressProvider.loadAddresses,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  BlynkSpace.s8,
                  BlynkSpace.s4,
                  BlynkSpace.s8,
                  BlynkSpace.s32,
                ),
                children: [
                  const AddNewAddressCard(),
                  if (addressProvider.isLoading)
                    // The list's own shape while it loads, so nothing jumps
                    // when the real rows arrive.
                    const Column(
                      children: [
                        ListRowSkeleton(),
                        ListRowSkeleton(),
                        ListRowSkeleton(),
                      ],
                    )
                  else if (addressProvider.failure != null)
                    // A real failure, with the mapped customer copy - never
                    // dressed up as "you have no addresses".
                    FailureState(
                      failure: addressProvider.failure!,
                      title: "We couldn't load your addresses",
                      retryKey: const Key('addresses-retry'),
                      scrollable: false,
                      onRetry: addressProvider.loadAddresses,
                    )
                  else if (addressProvider.addresses.isEmpty)
                    // Genuinely empty, and it says so in those words - the
                    // failure branch above is the only thing that reports a
                    // problem. Written out rather than an AppStateView
                    // because that one scrolls, and a scroll view cannot be
                    // nested inside this list's unbounded height.
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: BlynkSpace.s24,
                        vertical: BlynkSpace.s48,
                      ),
                      child: Column(
                        children: [
                          const ExcludeSemantics(
                            child: Icon(
                              BlynkIcons.empty,
                              size: BlynkIcons.lg,
                              color: BlynkColors.ink3,
                            ),
                          ),
                          const SizedBox(height: BlynkSpace.s16),
                          const Text(
                            'No saved addresses yet.',
                            textAlign: TextAlign.center,
                            style: BlynkText.heading,
                          ),
                          const SizedBox(height: BlynkSpace.s8),
                          Text(
                            'Add one and it will be ready the next time you check out.',
                            textAlign: TextAlign.center,
                            style: BlynkText.body.copyWith(color: BlynkColors.ink3),
                          ),
                        ],
                      ),
                    )
                  else
                    ...addressProvider.addresses.map(
                      (address) => AddressCard(address: address),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
