import 'package:flutter/material.dart';

import '../../../Screens/add_edit_address_screen.dart';
import '../../../design/tokens.dart';

/// The "Add new address" row that sits with the saved-address cards.
///
/// W8 re-skin: it is the same card surface as [AddressCard] beside it
/// (`BlynkCardProduct.surface`/`.radius`/`.elevation`) instead of
/// `Colors.white` and a hand-typed radius, and the "+" is the app's ink, not
/// the retired brand green. Behaviour is unchanged: it pushes
/// [AddEditAddressScreen] with no existing address.
class AddNewAddressCard extends StatelessWidget {
  const AddNewAddressCard({
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BlynkCardProduct.radius,
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const AddEditAddressScreen()),
      ),
      child: Container(
        constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
        padding: const EdgeInsets.symmetric(
          vertical: BlynkSpace.s12,
          horizontal: BlynkSpace.s12,
        ),
        margin: const EdgeInsets.symmetric(vertical: BlynkSpace.s8),
        decoration: const BoxDecoration(
          color: BlynkCardProduct.surface,
          borderRadius: BlynkCardProduct.radius,
          boxShadow: BlynkCardProduct.elevation,
        ),
        child: const Row(
          children: [
            Icon(
              Icons.add,
              color: BlynkColors.ink,
              size: BlynkIcons.sm,
            ),
            SizedBox(width: BlynkSpace.s8),
            Expanded(
              child: Text(
                'Add new address',
                style: BlynkText.heading,
              ),
            )
          ],
        ),
      ),
    );
  }
}
