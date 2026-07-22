import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_tokens.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/widgets/verified_remote_media.dart';

import '../../test_app.dart';

void main() {
  test('first cart item never substitutes a later item image', () {
    final selection = selectFirstMainCartMedia([
      {
        'itemCode': 'first-text-only',
        'name': 'Món đầu tiên chỉ có chữ',
        'category': 'Nhãn trùng',
        'imageUrl': '',
      },
      {
        'itemCode': 'later-with-image',
        'name': 'Món khác',
        'category': 'Nhãn trùng',
        'imageUrl': 'https://static.kfcvietnam.com.vn/LATER.jpg',
      },
    ]);

    expect(selection, isNull);
  });

  test(
    'cart media selection ignores renamed and duplicate category labels',
    () {
      const firstImageUrl =
          'https://static.kfcvietnam.com.vn/FIRST-CART-ITEM.jpg';
      const laterImageUrl =
          'https://static.kfcvietnam.com.vn/LATER-CART-ITEM.jpg';

      FirstCartMedia? selectWithFirstLabel(String firstLabel) {
        return selectFirstMainCartMedia([
          {
            'itemCode': 'first-item',
            'name': 'Món đầu tiên',
            'category': firstLabel,
            'imageUrl': firstImageUrl,
          },
          {
            'itemCode': 'later-item',
            'name': 'Món sau',
            'category': 'Nhãn trùng',
            'imageUrl': laterImageUrl,
          },
        ]);
      }

      for (final label in ['Nhãn cũ', 'Nhãn trùng']) {
        final selection = selectWithFirstLabel(label);
        expect(selection?.identity, 'first-item');
        expect(selection?.imageUrl, firstImageUrl);
        expect(selection?.imageUrl, isNot(laterImageUrl));
      }
    },
  );

  testWidgets(
    'verified media preserves ratio, labels loading, and fully collapses errors',
    (tester) async {
      final semantics = tester.ensureSemantics();
      const imageKey = Key('verifiedRemoteMedia');
      const imageUrl =
          'https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET5COB.jpg?v=LNN7PL';

      await tester.pumpWidget(
        const TestApp(
          child: Column(
            children: [
              VerifiedRemoteMedia(
                imageKey: imageKey,
                imageUrl: imageUrl,
                semanticLabel: 'Hình món Xô Zòn Zã 159K',
                width: 160,
                height: 100,
              ),
              Text('Nội dung vẫn còn'),
            ],
          ),
        ),
      );

      final image = tester.widget<Image>(find.byKey(imageKey));
      final networkImage = image.image as NetworkImage;
      expect(networkImage.url, imageUrl);
      expect(image.fit, BoxFit.contain);
      expect(
        networkImage.webHtmlElementStrategy,
        WebHtmlElementStrategy.prefer,
        reason:
            'Official KFC CDN images must render through an HTML image element '
            'when CanvasKit fetches are blocked by CORS.',
      );
      expect(image.semanticLabel, 'Hình món Xô Zòn Zã 159K');
      expect(
        find.descendant(
          of: find.byKey(imageKey),
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is ColoredBox &&
                widget.color == KfcOpsTokens.surfaceContainerLow,
          ),
        ),
        findsOneWidget,
      );
      expect(find.bySemanticsLabel('Hình món Xô Zòn Zã 159K'), findsOneWidget);

      await tester.pumpAndSettle();

      expect(tester.getSize(find.byKey(imageKey)), Size.zero);
      expect(find.text('Nội dung vẫn còn'), findsOneWidget);
      expect(find.byType(Placeholder), findsNothing);
      semantics.dispose();
    },
  );

  testWidgets(
    'unofficial or non-HTTPS media collapses before creating an image',
    (tester) async {
      for (final url in [
        'https://example.com/not-kfc.jpg',
        'http://static.kfcvietnam.com.vn/not-secure.jpg',
      ]) {
        await tester.pumpWidget(
          TestApp(
            child: VerifiedRemoteMedia(
              imageKey: const Key('rejectedRemoteMedia'),
              imageUrl: url,
              semanticLabel: 'Không được hiển thị',
              height: 100,
            ),
          ),
        );
        expect(find.byType(Image), findsNothing);
      }
    },
  );
}
