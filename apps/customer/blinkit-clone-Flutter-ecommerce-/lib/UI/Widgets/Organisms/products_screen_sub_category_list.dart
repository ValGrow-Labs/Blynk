import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/category_model.dart';
import '../../../design/tokens.dart';
import '../../../Services/Providers/product.provider.dart';

// The backend's catalog is flat (categories, no nested subcategories - see
// backend/api/src/database/migrations/001_initial_schema.sql), so this is
// repurposed as a "browse other categories" rail using the same real
// category list shown on Home, rather than an invented subcategory taxonomy.
class CategorySidebar extends StatelessWidget {
  const CategorySidebar({super.key, required this.activeSlug, required this.onSelect});

  final String activeSlug;
  final ValueChanged<CategoryModel> onSelect;

  @override
  Widget build(BuildContext context) {
    final categories = context.watch<ProductProvider>().categories;

    if (categories.isEmpty) {
      return const SizedBox.shrink();
    }

    return ListView.builder(
      shrinkWrap: true,
      physics: const BouncingScrollPhysics(),
      itemCount: categories.length,
      itemBuilder: (BuildContext context, int index) {
        final category = categories[index];
        final isActive = category.slug == activeSlug;

        return Semantics(
          button: true,
          selected: isActive,
          label: category.name,
          excludeSemantics: true,
          onTap: () => onSelect(category),
          child: InkWell(
            onTap: () => onSelect(category),
            child: Container(
              margin: const EdgeInsets.symmetric(vertical: 4),
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
              // A floor, not a height: a large text size grows the row.
              constraints: const BoxConstraints(minHeight: 48),
              decoration: BoxDecoration(
                border: isActive
                    ? const Border(
                        right: BorderSide(color: BlynkColors.ink, width: 3),
                      )
                    : null,
              ),
              child: Column(
                children: [
                  CircleAvatar(
                    radius: 20,
                    backgroundColor: BlynkColors.well,
                    backgroundImage: category.imageUrl != null && category.imageUrl!.isNotEmpty
                        ? NetworkImage(category.imageUrl!)
                        : null,
                    child: category.imageUrl == null || category.imageUrl!.isEmpty
                        ? const Icon(Icons.category_outlined, color: BlynkColors.ink2)
                        : null,
                  ),
                  Text(
                    category.name,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
