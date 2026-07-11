import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_tokens.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/widgets/verified_remote_media.dart';

import '../../test_app.dart';

void main() {
  test('first explicit main item never substitutes another item image', () {
    final selection = selectFirstMainCartMedia([
      {
        'itemCode': 'drink',
        'name': 'Pepsi',
        'category': 'drink',
        'imageUrl': 'https://static.kfcvietnam.com.vn/PEPSI-L.jpg',
      },
      {
        'itemCode': 'main-text-only',
        'name': 'Món chính chỉ có chữ',
        'category': 'main',
        'imageUrl': '',
      },
      {
        'itemCode': 'second-main',
        'name': 'Món chính khác',
        'category': 'main',
        'imageUrl': 'https://static.kfcvietnam.com.vn/SECOND-MAIN.jpg',
      },
    ]);

    expect(selection, isNull);
  });

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
