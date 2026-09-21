import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../design/tokens.dart';
import '../../../Services/Providers/address.provider.dart';

class CartScreenAddressContainer extends StatefulWidget {
  const CartScreenAddressContainer({
    super.key,
  });

  @override
  State<CartScreenAddressContainer> createState() => _CartScreenAddressContainerState();
}

class _CartScreenAddressContainerState extends State<CartScreenAddressContainer> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final addressProvider = context.read<AddressProvider>();
      if (addressProvider.addresses.isEmpty) {
        addressProvider.loadAddresses();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final address = context.watch<AddressProvider>().defaultAddress;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: const BoxDecoration(
        color: BlynkColors.paper,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20.0),
          topRight: Radius.circular(20.0),
        ),
      ),
      width: double.infinity,
      // A floor, not a fixed height: two lines of text at a large text size
      // must be able to grow the row.
      constraints: const BoxConstraints(minHeight: 70),
      child: Center(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Row(
                children: [
                  const Icon(
                    BlynkIcons.addressHome,
                    color: BlynkColors.ink2,
                  ),
                  const SizedBox(
                    width: 15,
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          address != null
                              ? 'Delivering to ${address.label}'
                              : 'No delivery address yet',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                        Text(
                          address?.displaySummary ?? 'Add an address to check out',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w500),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            // A real 48 dp button (it was bare tappable text with no semantics).
            TextButton(
              onPressed: () {
                Navigator.of(context).pushNamed('/user/address');
              },
              style: TextButton.styleFrom(
                minimumSize: const Size(48, 48),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                tapTargetSize: MaterialTapTargetSize.padded,
              ),
              child: Semantics(
                label: address != null ? 'Change delivery address' : 'Add delivery address',
                excludeSemantics: true,
                child: Text(
                  address != null ? "Change" : "Add",
                  style: const TextStyle(
                    color: BlynkColors.ink,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
