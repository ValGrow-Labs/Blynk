import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/design/tokens.dart';
import '../UI/Widgets/Atoms/list_tile.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Organisms/logout_dialog.dart';
import 'customer_shell.dart';
import '../app_responsive.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: true,
        title: const Text('Profile'),
      ),
      body: ContentFrame(
        maxWidth: 720,
        gutter: false,
        child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.start,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Consumer<AuthProvider>(
              builder: (context, auth, _) {
                final user = auth.currentUser;
                final displayName = (user?.fullName != null && user!.fullName!.isNotEmpty)
                    ? user.fullName!
                    : 'My Account';
                final displayPhone = user?.phone ?? '';

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(displayName, style: BlynkText.title),
                    if (displayPhone.isNotEmpty)
                      Text(
                        displayPhone,
                        style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                      ),
                  ],
                );
              },
            ),
            const SizedBox(height: BlynkSpace.s24),
            // A guest browses freely; logging in is one clear step, not a wall.
            if (!context.select<AuthProvider, bool>((a) => a.isAuthenticated)) ...[
              BlynkButton.primary(
                label: 'Log in',
                expand: true,
                onPressed: () => Navigator.of(context).pushNamed('/login'),
              ),
              const SizedBox(height: BlynkSpace.s16),
            ],
            customListTile(
              icon: BlynkIcons.orders,
              title: 'Your orders',
              callback: () => CustomerShell.selectTab(context, 1),
            ),
            customListTile(
              icon: BlynkIcons.addressBook,
              title: 'Address book',
              callback: () {
                Navigator.of(context).pushNamed('/user/address');
              },
            ),
            customListTile(
              icon: BlynkIcons.share,
              title: 'Share the app',
              callback: () {
                Share.share(
                  'Blynk Quick-Commerce App',
                  subject: "Blynk App",
                );
              },
            ),
            customListTile(
              icon: BlynkIcons.info,
              title: 'About us',
              callback: () {
                Navigator.of(context).pushNamed('/app/about');
              },
            ),
            if (context.select<AuthProvider, bool>((a) => a.isAuthenticated))
              customListTile(
                icon: BlynkIcons.logout,
                title: 'Log out',
                callback: () => showLogoutDialog(context),
              ),
          ],
        ),
      ),
      ),
    );
  }
}
