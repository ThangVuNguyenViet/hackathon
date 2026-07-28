// THROWAWAY PROTOTYPE: do not treat this fixture-backed surface as production.
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:web/web.dart' as web;

import '../../../app/theme/kfc_ops_tokens.dart';

enum _PrototypeVariant {
  guided('A', 'Guided moments', 'Large, focused recommendation moments'),
  rail('B', 'Contextual rail', 'Recommendations stay beside the menu'),
  cart('C', 'Cart modules', 'Recommendations live inside cart review');

  const _PrototypeVariant(this.code, this.title, this.description);

  final String code;
  final String title;
  final String description;

  static _PrototypeVariant fromUri() {
    final requested = Uri.base.queryParameters['variant']?.toUpperCase();
    return values.firstWhere(
      (variant) => variant.code == requested,
      orElse: () => guided,
    );
  }
}

enum _JourneyStage { starter, modifier, crossSell, complete }

enum _CustomerProfile { returning, anonymous }

class _MenuItem {
  const _MenuItem({
    required this.id,
    required this.name,
    required this.description,
    required this.price,
    required this.emoji,
    required this.category,
    required this.score,
  });

  final String id;
  final String name;
  final String description;
  final int price;
  final String emoji;
  final String category;
  final double score;
}

class _CartLine {
  const _CartLine({
    required this.id,
    required this.name,
    required this.price,
    required this.emoji,
  });

  final String id;
  final String name;
  final int price;
  final String emoji;
}

class _EvidenceEvent {
  const _EvidenceEvent(this.label, this.detail);

  final String label;
  final String detail;
}

const _catalog = <_MenuItem>[
  _MenuItem(
    id: 'combo-ga-gion-cay',
    name: 'Combo Gà Giòn Cay',
    description: '2 miếng gà, khoai tây vừa và Pepsi',
    price: 99000,
    emoji: '🍗',
    category: 'Combo',
    score: 0.86,
  ),
  _MenuItem(
    id: 'burger-zinger',
    name: 'Burger Zinger',
    description: 'Gà giòn cay, xà lách và sốt đặc trưng',
    price: 59000,
    emoji: '🍔',
    category: 'Burger',
    score: 0.81,
  ),
  _MenuItem(
    id: 'bucket-6',
    name: 'Bucket 6 Miếng',
    description: '6 miếng gà giòn để chia sẻ',
    price: 189000,
    emoji: '🪣',
    category: 'Bucket',
    score: 0.78,
  ),
  _MenuItem(
    id: 'ga-popcorn',
    name: 'Gà Popcorn',
    description: 'Gà viên giòn, tiện dùng chung',
    price: 49000,
    emoji: '🍿',
    category: 'Ăn kèm',
    score: 0.72,
  ),
  _MenuItem(
    id: 'khoai-vua',
    name: 'Khoai Tây Chiên Vừa',
    description: 'Khoai tây vàng giòn',
    price: 35000,
    emoji: '🍟',
    category: 'Ăn kèm',
    score: 0.69,
  ),
  _MenuItem(
    id: 'pepsi-lon',
    name: 'Pepsi Lon',
    description: 'Nước ngọt dùng lạnh',
    price: 25000,
    emoji: '🥤',
    category: 'Nước',
    score: 0.63,
  ),
];

const _modifierOptions = <_MenuItem>[
  _MenuItem(
    id: 'modifier-pho-mai',
    name: 'Thêm Phô Mai',
    description: 'Thêm một lát phô mai',
    price: 12000,
    emoji: '🧀',
    category: 'Modifier',
    score: 0.84,
  ),
  _MenuItem(
    id: 'modifier-hashbrown',
    name: 'Thêm Hash Brown',
    description: 'Khoai băm chiên giòn',
    price: 19000,
    emoji: '🥔',
    category: 'Modifier',
    score: 0.76,
  ),
  _MenuItem(
    id: 'modifier-sot-cay',
    name: 'Thêm Sốt Cay',
    description: 'Một phần sốt cay',
    price: 8000,
    emoji: '🌶️',
    category: 'Modifier',
    score: 0.67,
  ),
];

class KioskRecommendationPrototypeScreen extends StatefulWidget {
  const KioskRecommendationPrototypeScreen({super.key});

  @override
  State<KioskRecommendationPrototypeScreen> createState() =>
      _KioskRecommendationPrototypeScreenState();
}

class _KioskRecommendationPrototypeScreenState
    extends State<KioskRecommendationPrototypeScreen> {
  late _PrototypeVariant _variant;
  final _focusNode = FocusNode();
  _CustomerProfile _profile = _CustomerProfile.returning;
  _JourneyStage _stage = _JourneyStage.starter;
  final List<_CartLine> _cart = [];
  final List<_EvidenceEvent> _events = [];
  String? _parentCartLineId;
  int _cartRevision = 0;
  int _referenceSubtotal = 0;
  bool _evidenceOpen = false;

  @override
  void initState() {
    super.initState();
    _variant = _PrototypeVariant.fromUri();
    _recordStarterRequest();
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  String get _starterEndpoint => _profile == _CustomerProfile.returning
      ? '/v1/recommendations/for-you'
      : '/v1/recommendations/local-favorites';

  String get _activeEndpoint => switch (_stage) {
    _JourneyStage.starter => _starterEndpoint,
    _JourneyStage.modifier => '/v1/recommendations/modifier-upsells',
    _JourneyStage.crossSell => '/v1/recommendations/smart-cross-sells',
    _JourneyStage.complete => 'No pending recommendation request',
  };

  List<_MenuItem> get _activeRecommendations => switch (_stage) {
    _JourneyStage.starter =>
      _profile == _CustomerProfile.returning
          ? [_catalog[0], _catalog[1], _catalog[3]]
          : [_catalog[2], _catalog[0], _catalog[1], _catalog[3]],
    _JourneyStage.modifier => _modifierOptions,
    _JourneyStage.crossSell => [
      _catalog[4],
      _catalog[3],
      _catalog[5],
      _catalog[1],
    ],
    _JourneyStage.complete => const [],
  };

  int get _subtotal => _cart.fold(0, (total, line) => total + line.price);

  double get _basketLift {
    if (_referenceSubtotal == 0) return 0;
    return (_subtotal - _referenceSubtotal) / _referenceSubtotal;
  }

  String get _recommendationTitle => switch (_stage) {
    _JourneyStage.starter when _profile == _CustomerProfile.returning =>
      'Dành riêng cho bạn',
    _JourneyStage.starter => 'Món được yêu thích gần đây',
    _JourneyStage.modifier => 'Bạn muốn thêm vào món này?',
    _JourneyStage.crossSell => 'Hoàn thiện bữa ăn',
    _JourneyStage.complete => 'Đã hoàn tất gợi ý tự động',
  };

  String get _recommendationSubtitle => switch (_stage) {
    _JourneyStage.starter when _profile == _CustomerProfile.returning =>
      'Xếp hạng từ lịch sử mua đã xác minh và ngữ cảnh hiện tại.',
    _JourneyStage.starter =>
      'Xếp hạng từ tín hiệu cửa hàng và ngữ cảnh hiện tại.',
    _JourneyStage.modifier =>
      'Các lựa chọn hợp lệ cho món vừa thêm. Chọn tối đa một.',
    _JourneyStage.crossSell =>
      '3–4 món bổ sung được xếp hạng cho giỏ hàng hiện tại.',
    _JourneyStage.complete =>
      'Kiosk không gọi thêm endpoint chủ động trong hành trình này.',
  };

  void _recordStarterRequest() {
    _events
      ..clear()
      ..add(
        _EvidenceEvent(
          'Kiosk requested ${_starterEndpoint.split('/').last}',
          _profile == _CustomerProfile.returning
              ? 'Verified customer history was supplied.'
              : 'No customer history was supplied.',
        ),
      )
      ..add(
        const _EvidenceEvent(
          'Eligibility filtered candidates',
          'Availability, channel and catalog constraints passed.',
        ),
      )
      ..add(
        const _EvidenceEvent(
          'Automatic ranker returned a slate',
          'Synthetic model revision kfc-auto-lgbm-2026-07-poc.',
        ),
      );
  }

  void _reset({_CustomerProfile? profile}) {
    setState(() {
      _profile = profile ?? _profile;
      _stage = _JourneyStage.starter;
      _cart.clear();
      _parentCartLineId = null;
      _cartRevision = 0;
      _referenceSubtotal = 0;
      _recordStarterRequest();
    });
  }

  void _setVariant(_PrototypeVariant variant) {
    if (_variant == variant) return;
    final params = Map<String, String>.from(Uri.base.queryParameters);
    params['variant'] = variant.code;
    final uri = Uri.base.replace(queryParameters: params);
    web.window.history.replaceState(null, '', uri.toString());
    setState(() => _variant = variant);
  }

  void _moveVariant(int delta) {
    final variants = _PrototypeVariant.values;
    final next = (_variant.index + delta) % variants.length;
    _setVariant(variants[next < 0 ? next + variants.length : next]);
  }

  void _onKeyEvent(KeyEvent event) {
    if (event is! KeyDownEvent) return;
    if (event.logicalKey == LogicalKeyboardKey.arrowLeft) {
      _moveVariant(-1);
    } else if (event.logicalKey == LogicalKeyboardKey.arrowRight) {
      _moveVariant(1);
    }
  }

  void _selectRecommendation(_MenuItem item) {
    setState(() {
      switch (_stage) {
        case _JourneyStage.starter:
          final lineId = 'line-${_cartRevision + 1}-${item.id}';
          _cart.add(
            _CartLine(
              id: lineId,
              name: item.name,
              price: item.price,
              emoji: item.emoji,
            ),
          );
          _cartRevision += 1;
          _parentCartLineId = lineId;
          _referenceSubtotal = _subtotal;
          _events
            ..add(
              _EvidenceEvent(
                'Customer selected ${item.name}',
                'Kiosk mutated cart; the engine did not.',
              ),
            )
            ..add(
              _EvidenceEvent(
                'Kiosk requested modifier-upsells',
                'parentCartLineId=$lineId · cartRevision=$_cartRevision',
              ),
            );
          _stage = _JourneyStage.modifier;
        case _JourneyStage.modifier:
          _cart.add(
            _CartLine(
              id: 'line-${_cartRevision + 1}-${item.id}',
              name: '${item.name} · ${_parentCartLineName()}',
              price: item.price,
              emoji: item.emoji,
            ),
          );
          _cartRevision += 1;
          _events
            ..add(
              _EvidenceEvent(
                'Customer selected ${item.name}',
                'Kiosk applied the modifier to $_parentCartLineId.',
              ),
            )
            ..add(
              _EvidenceEvent(
                'Kiosk requested smart-cross-sells',
                'Current cart snapshot · cartRevision=$_cartRevision',
              ),
            );
          _stage = _JourneyStage.crossSell;
        case _JourneyStage.crossSell:
          _cart.add(
            _CartLine(
              id: 'line-${_cartRevision + 1}-${item.id}',
              name: item.name,
              price: item.price,
              emoji: item.emoji,
            ),
          );
          _cartRevision += 1;
          _events.add(
            _EvidenceEvent(
              'Customer selected ${item.name}',
              'Outcome and cart-mutation success were reported.',
            ),
          );
          _stage = _JourneyStage.complete;
        case _JourneyStage.complete:
          break;
      }
    });
  }

  String _parentCartLineName() {
    return _cart
        .firstWhere(
          (line) => line.id == _parentCartLineId,
          orElse: () => const _CartLine(
            id: 'unknown',
            name: 'món đã chọn',
            price: 0,
            emoji: '',
          ),
        )
        .name;
  }

  void _dismissRecommendation() {
    setState(() {
      switch (_stage) {
        case _JourneyStage.starter:
          _events.add(
            const _EvidenceEvent(
              'Starter slate dismissed',
              'No cart mutation; outcome was reported.',
            ),
          );
          _stage = _JourneyStage.complete;
        case _JourneyStage.modifier:
          _events
            ..add(
              const _EvidenceEvent(
                'Modifier slate dismissed',
                'All displayed modifier actions were rejected.',
              ),
            )
            ..add(
              _EvidenceEvent(
                'Kiosk requested smart-cross-sells',
                'Current cart snapshot · cartRevision=$_cartRevision',
              ),
            );
          _stage = _JourneyStage.crossSell;
        case _JourneyStage.crossSell:
          _events.add(
            const _EvidenceEvent(
              'Cross-sell slate dismissed',
              'No cart mutation; outcome was reported.',
            ),
          );
          _stage = _JourneyStage.complete;
        case _JourneyStage.complete:
          break;
      }
    });
  }

  void _addMenuItem(_MenuItem item) {
    if (_stage != _JourneyStage.starter) return;
    _selectRecommendation(item);
  }

  @override
  Widget build(BuildContext context) {
    return KeyboardListener(
      autofocus: true,
      focusNode: _focusNode,
      onKeyEvent: _onKeyEvent,
      child: Scaffold(
        body: Stack(
          children: [
            SafeArea(
              child: Column(
                children: [
                  _PrototypeHeader(
                    profile: _profile,
                    cartCount: _cart.length,
                    evidenceOpen: _evidenceOpen,
                    onProfileChanged: (profile) => _reset(profile: profile),
                    onReset: _reset,
                    onEvidence: () =>
                        setState(() => _evidenceOpen = !_evidenceOpen),
                  ),
                  Expanded(
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 180),
                      child: switch (_variant) {
                        _PrototypeVariant.guided => _GuidedVariant(
                          key: const ValueKey('guided'),
                          stage: _stage,
                          title: _recommendationTitle,
                          subtitle: _recommendationSubtitle,
                          recommendations: _activeRecommendations,
                          cart: _cart,
                          subtotal: _subtotal,
                          lift: _basketLift,
                          onSelect: _selectRecommendation,
                          onDismiss: _dismissRecommendation,
                          onMenuAdd: _addMenuItem,
                        ),
                        _PrototypeVariant.rail => _RailVariant(
                          key: const ValueKey('rail'),
                          stage: _stage,
                          title: _recommendationTitle,
                          subtitle: _recommendationSubtitle,
                          recommendations: _activeRecommendations,
                          cart: _cart,
                          subtotal: _subtotal,
                          lift: _basketLift,
                          onSelect: _selectRecommendation,
                          onDismiss: _dismissRecommendation,
                          onMenuAdd: _addMenuItem,
                        ),
                        _PrototypeVariant.cart => _CartModuleVariant(
                          key: const ValueKey('cart'),
                          stage: _stage,
                          title: _recommendationTitle,
                          subtitle: _recommendationSubtitle,
                          recommendations: _activeRecommendations,
                          cart: _cart,
                          subtotal: _subtotal,
                          lift: _basketLift,
                          onSelect: _selectRecommendation,
                          onDismiss: _dismissRecommendation,
                          onMenuAdd: _addMenuItem,
                        ),
                      },
                    ),
                  ),
                ],
              ),
            ),
            if (_evidenceOpen)
              Positioned.fill(
                child: _EvidenceOverlay(
                  stage: _stage,
                  endpoint: _activeEndpoint,
                  events: _events,
                  cartRevision: _cartRevision,
                  cart: _cart,
                  subtotal: _subtotal,
                  lift: _basketLift,
                  onClose: () => setState(() => _evidenceOpen = false),
                ),
              ),
            if (!kReleaseMode)
              Positioned(
                left: 0,
                right: 0,
                bottom: 16,
                child: Center(
                  child: _VariantSwitcher(
                    variant: _variant,
                    onPrevious: () => _moveVariant(-1),
                    onNext: () => _moveVariant(1),
                    onSelected: _setVariant,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _PrototypeHeader extends StatelessWidget {
  const _PrototypeHeader({
    required this.profile,
    required this.cartCount,
    required this.evidenceOpen,
    required this.onProfileChanged,
    required this.onReset,
    required this.onEvidence,
  });

  final _CustomerProfile profile;
  final int cartCount;
  final bool evidenceOpen;
  final ValueChanged<_CustomerProfile> onProfileChanged;
  final VoidCallback onReset;
  final VoidCallback onEvidence;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 76,
      padding: const EdgeInsets.symmetric(horizontal: 28),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFE8E3DC))),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: KfcOpsTokens.primaryContainer,
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Text(
              'KFC',
              style: TextStyle(
                color: Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          const SizedBox(width: 14),
          const Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Kiosk recommendation journey',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              ),
              Text(
                'THROWAWAY PROTOTYPE · synthetic automatic responses',
                style: TextStyle(
                  fontSize: 10,
                  color: KfcOpsTokens.secondary,
                  letterSpacing: 0.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const Spacer(),
          SegmentedButton<_CustomerProfile>(
            segments: const [
              ButtonSegment(
                value: _CustomerProfile.returning,
                label: Text('Returning customer'),
                icon: Icon(Icons.person_rounded, size: 17),
              ),
              ButtonSegment(
                value: _CustomerProfile.anonymous,
                label: Text('Anonymous'),
                icon: Icon(Icons.person_outline_rounded, size: 17),
              ),
            ],
            selected: {profile},
            onSelectionChanged: (value) => onProfileChanged(value.first),
            style: const ButtonStyle(
              visualDensity: VisualDensity(horizontal: -1, vertical: -2),
            ),
          ),
          const SizedBox(width: 10),
          IconButton.filledTonal(
            tooltip: 'Reset journey',
            onPressed: onReset,
            icon: const Icon(Icons.refresh_rounded),
          ),
          const SizedBox(width: 8),
          FilledButton.icon(
            onPressed: onEvidence,
            icon: Icon(
              evidenceOpen
                  ? Icons.visibility_off_rounded
                  : Icons.account_tree_rounded,
              size: 18,
            ),
            label: const Text('Presenter evidence'),
          ),
          const SizedBox(width: 12),
          Badge(
            label: Text('$cartCount'),
            child: const Icon(Icons.shopping_bag_outlined, size: 26),
          ),
        ],
      ),
    );
  }
}

class _GuidedVariant extends StatelessWidget {
  const _GuidedVariant({
    super.key,
    required this.stage,
    required this.title,
    required this.subtitle,
    required this.recommendations,
    required this.cart,
    required this.subtotal,
    required this.lift,
    required this.onSelect,
    required this.onDismiss,
    required this.onMenuAdd,
  });

  final _JourneyStage stage;
  final String title;
  final String subtitle;
  final List<_MenuItem> recommendations;
  final List<_CartLine> cart;
  final int subtotal;
  final double lift;
  final ValueChanged<_MenuItem> onSelect;
  final VoidCallback onDismiss;
  final ValueChanged<_MenuItem> onMenuAdd;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(
          width: 94,
          child: _CategoryStrip(selected: stage == _JourneyStage.starter),
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 22, 12, 82),
            child: Stack(
              children: [
                _MenuGrid(
                  onAdd: onMenuAdd,
                  enabled: stage == _JourneyStage.starter,
                ),
                Positioned.fill(
                  child: ColoredBox(
                    color: const Color(0xFFF7F4EF).withValues(alpha: 0.84),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 880),
                        child: _RecommendationMoment(
                          stage: stage,
                          title: title,
                          subtitle: subtitle,
                          recommendations: recommendations,
                          onSelect: onSelect,
                          onDismiss: onDismiss,
                          horizontal: true,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        SizedBox(
          width: 310,
          child: _CartPanel(
            cart: cart,
            subtotal: subtotal,
            lift: lift,
            compact: true,
          ),
        ),
      ],
    );
  }
}

class _RailVariant extends StatelessWidget {
  const _RailVariant({
    super.key,
    required this.stage,
    required this.title,
    required this.subtitle,
    required this.recommendations,
    required this.cart,
    required this.subtotal,
    required this.lift,
    required this.onSelect,
    required this.onDismiss,
    required this.onMenuAdd,
  });

  final _JourneyStage stage;
  final String title;
  final String subtitle;
  final List<_MenuItem> recommendations;
  final List<_CartLine> cart;
  final int subtotal;
  final double lift;
  final ValueChanged<_MenuItem> onSelect;
  final VoidCallback onDismiss;
  final ValueChanged<_MenuItem> onMenuAdd;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(
          width: 94,
          child: _CategoryStrip(selected: stage == _JourneyStage.starter),
        ),
        Expanded(
          flex: 6,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 22, 12, 82),
            child: _MenuGrid(
              onAdd: onMenuAdd,
              enabled: stage == _JourneyStage.starter,
            ),
          ),
        ),
        Expanded(
          flex: 4,
          child: Container(
            margin: const EdgeInsets.fromLTRB(8, 16, 16, 76),
            decoration: BoxDecoration(
              color: const Color(0xFF161515),
              borderRadius: BorderRadius.circular(24),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(18),
                    child: Theme(
                      data: Theme.of(context).copyWith(
                        colorScheme: Theme.of(context).colorScheme.copyWith(
                          surface: const Color(0xFF242222),
                          onSurface: Colors.white,
                        ),
                      ),
                      child: _RecommendationMoment(
                        stage: stage,
                        title: title,
                        subtitle: subtitle,
                        recommendations: recommendations,
                        onSelect: onSelect,
                        onDismiss: onDismiss,
                        dark: true,
                      ),
                    ),
                  ),
                ),
                _RailCartSummary(cart: cart, subtotal: subtotal, lift: lift),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _CartModuleVariant extends StatelessWidget {
  const _CartModuleVariant({
    super.key,
    required this.stage,
    required this.title,
    required this.subtitle,
    required this.recommendations,
    required this.cart,
    required this.subtotal,
    required this.lift,
    required this.onSelect,
    required this.onDismiss,
    required this.onMenuAdd,
  });

  final _JourneyStage stage;
  final String title;
  final String subtitle;
  final List<_MenuItem> recommendations;
  final List<_CartLine> cart;
  final int subtotal;
  final double lift;
  final ValueChanged<_MenuItem> onSelect;
  final VoidCallback onDismiss;
  final ValueChanged<_MenuItem> onMenuAdd;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(
          width: 94,
          child: _CategoryStrip(selected: stage == _JourneyStage.starter),
        ),
        Expanded(
          flex: 5,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 22, 12, 82),
            child: _MenuGrid(
              onAdd: onMenuAdd,
              enabled: stage == _JourneyStage.starter,
            ),
          ),
        ),
        Expanded(
          flex: 5,
          child: Container(
            margin: const EdgeInsets.fromLTRB(8, 16, 16, 76),
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: const Color(0xFFE7E1D8)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Your order',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      children: [
                        _CartLines(cart: cart),
                        const SizedBox(height: 14),
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: const Color(0xFFFFF6F4),
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(color: const Color(0xFFF1C8C0)),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: _RecommendationMoment(
                              stage: stage,
                              title: title,
                              subtitle: subtitle,
                              recommendations: recommendations,
                              onSelect: onSelect,
                              onDismiss: onDismiss,
                              compact: true,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                _CheckoutSummary(subtotal: subtotal, lift: lift),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _CategoryStrip extends StatelessWidget {
  const _CategoryStrip({required this.selected});

  final bool selected;

  @override
  Widget build(BuildContext context) {
    const categories = [
      ('⭐', 'Gợi ý'),
      ('🪣', 'Bucket'),
      ('🍗', 'Combo'),
      ('🍔', 'Burger'),
      ('🍟', 'Ăn kèm'),
      ('🥤', 'Nước'),
    ];
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 18, 12, 84),
      color: Colors.white,
      child: ListView.separated(
        itemCount: categories.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, index) {
          final active = index == 0 && selected;
          return Container(
            padding: const EdgeInsets.symmetric(vertical: 11),
            decoration: BoxDecoration(
              color: active
                  ? KfcOpsTokens.primaryContainer
                  : const Color(0xFFF5F2EE),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              children: [
                Text(
                  categories[index].$1,
                  style: const TextStyle(fontSize: 22),
                ),
                const SizedBox(height: 3),
                Text(
                  categories[index].$2,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: active ? Colors.white : KfcOpsTokens.onSurface,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _MenuGrid extends StatelessWidget {
  const _MenuGrid({required this.onAdd, required this.enabled});

  final ValueChanged<_MenuItem> onAdd;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'What are you craving?',
          style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 4),
        const Text(
          'Tap an item to begin. The kiosk decides when to ask the engine.',
          style: TextStyle(color: KfcOpsTokens.secondary),
        ),
        const SizedBox(height: 18),
        Expanded(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth > 760 ? 3 : 2;
              return GridView.builder(
                itemCount: _catalog.length,
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: columns,
                  crossAxisSpacing: 14,
                  mainAxisSpacing: 14,
                  childAspectRatio: 1.18,
                ),
                itemBuilder: (context, index) => _MenuCard(
                  item: _catalog[index],
                  onPressed: enabled ? () => onAdd(_catalog[index]) : null,
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _MenuCard extends StatelessWidget {
  const _MenuCard({required this.item, this.onPressed});

  final _MenuItem item;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Center(
                  child: Text(item.emoji, style: const TextStyle(fontSize: 52)),
                ),
              ),
              Text(
                item.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      _money(item.price),
                      style: const TextStyle(
                        fontWeight: FontWeight.w900,
                        color: KfcOpsTokens.primary,
                      ),
                    ),
                  ),
                  Icon(
                    onPressed == null
                        ? Icons.check_circle_outline_rounded
                        : Icons.add_circle_rounded,
                    color: onPressed == null
                        ? KfcOpsTokens.secondary
                        : KfcOpsTokens.primaryContainer,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RecommendationMoment extends StatelessWidget {
  const _RecommendationMoment({
    required this.stage,
    required this.title,
    required this.subtitle,
    required this.recommendations,
    required this.onSelect,
    required this.onDismiss,
    this.horizontal = false,
    this.dark = false,
    this.compact = false,
  });

  final _JourneyStage stage;
  final String title;
  final String subtitle;
  final List<_MenuItem> recommendations;
  final ValueChanged<_MenuItem> onSelect;
  final VoidCallback onDismiss;
  final bool horizontal;
  final bool dark;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (stage == _JourneyStage.complete) {
      return _CompleteRecommendationState(dark: dark);
    }
    final foreground = dark ? Colors.white : KfcOpsTokens.onSurface;
    final muted = dark ? const Color(0xFFC8C2C0) : KfcOpsTokens.secondary;
    return Container(
      padding: horizontal ? const EdgeInsets.all(24) : EdgeInsets.zero,
      decoration: horizontal
          ? BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(26),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x22000000),
                  blurRadius: 32,
                  offset: Offset(0, 12),
                ),
              ],
            )
          : null,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  color: dark
                      ? const Color(0xFF4A2228)
                      : const Color(0xFFFFE7E2),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  _stageLabel(stage),
                  style: TextStyle(
                    color: dark
                        ? const Color(0xFFFF9A91)
                        : KfcOpsTokens.primary,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 0.4,
                  ),
                ),
              ),
              const Spacer(),
              const Icon(
                Icons.auto_awesome_rounded,
                size: 18,
                color: Color(0xFFE4A600),
              ),
              const SizedBox(width: 5),
              Text(
                'AUTOMATIC',
                style: TextStyle(
                  color: muted,
                  fontSize: 10,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            title,
            style: TextStyle(
              color: foreground,
              fontSize: compact ? 18 : 24,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            subtitle,
            style: TextStyle(color: muted, fontSize: 12, height: 1.35),
          ),
          const SizedBox(height: 15),
          if (horizontal)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (
                  var index = 0;
                  index < recommendations.length;
                  index++
                ) ...[
                  if (index > 0) const SizedBox(width: 10),
                  Expanded(
                    child: _RecommendationTile(
                      item: recommendations[index],
                      dark: dark,
                      compact: compact,
                      onSelect: () => onSelect(recommendations[index]),
                    ),
                  ),
                ],
              ],
            )
          else
            ...recommendations.map(
              (item) => Padding(
                padding: const EdgeInsets.only(bottom: 9),
                child: _RecommendationTile(
                  item: item,
                  dark: dark,
                  compact: compact,
                  onSelect: () => onSelect(item),
                ),
              ),
            ),
          const SizedBox(height: 3),
          SizedBox(
            width: double.infinity,
            child: TextButton(
              onPressed: onDismiss,
              style: TextButton.styleFrom(foregroundColor: muted),
              child: const Text('No thanks'),
            ),
          ),
        ],
      ),
    );
  }
}

class _RecommendationTile extends StatelessWidget {
  const _RecommendationTile({
    required this.item,
    required this.dark,
    required this.compact,
    required this.onSelect,
  });

  final _MenuItem item;
  final bool dark;
  final bool compact;
  final VoidCallback onSelect;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(compact ? 10 : 12),
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF2A2828) : const Color(0xFFF8F5F1),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(
          color: dark ? const Color(0xFF464141) : const Color(0xFFE7E1D8),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: compact ? 44 : 54,
            height: compact ? 44 : 54,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: dark ? const Color(0xFF383434) : Colors.white,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              item.emoji,
              style: TextStyle(fontSize: compact ? 25 : 30),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: dark ? Colors.white : KfcOpsTokens.onSurface,
                    fontSize: compact ? 12 : 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '${_money(item.price)} · score ${item.score.toStringAsFixed(2)}',
                  style: TextStyle(
                    color: dark
                        ? const Color(0xFFC8C2C0)
                        : KfcOpsTokens.secondary,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          FilledButton(
            onPressed: onSelect,
            style: FilledButton.styleFrom(
              padding: EdgeInsets.symmetric(
                horizontal: compact ? 10 : 13,
                vertical: 12,
              ),
              visualDensity: VisualDensity.compact,
            ),
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }
}

class _CompleteRecommendationState extends StatelessWidget {
  const _CompleteRecommendationState({required this.dark});

  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: const BoxDecoration(
              color: KfcOpsTokens.successContainer,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.check_rounded,
              color: KfcOpsTokens.success,
              size: 32,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Recommendation journey complete',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: dark ? Colors.white : KfcOpsTokens.onSurface,
              fontWeight: FontWeight.w900,
              fontSize: 18,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            'No further proactive endpoint call.\nContinue to checkout.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: dark ? const Color(0xFFC8C2C0) : KfcOpsTokens.secondary,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _CartPanel extends StatelessWidget {
  const _CartPanel({
    required this.cart,
    required this.subtotal,
    required this.lift,
    required this.compact,
  });

  final List<_CartLine> cart;
  final int subtotal;
  final double lift;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 84),
      color: Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Your order',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 12),
          Expanded(
            child: SingleChildScrollView(child: _CartLines(cart: cart)),
          ),
          _CheckoutSummary(subtotal: subtotal, lift: lift),
        ],
      ),
    );
  }
}

class _CartLines extends StatelessWidget {
  const _CartLines({required this.cart});

  final List<_CartLine> cart;

  @override
  Widget build(BuildContext context) {
    if (cart.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: const Color(0xFFF7F4EF),
          borderRadius: BorderRadius.circular(16),
        ),
        child: const Row(
          children: [
            Icon(Icons.shopping_bag_outlined, color: KfcOpsTokens.secondary),
            SizedBox(width: 10),
            Expanded(
              child: Text(
                'Your cart is empty',
                style: TextStyle(color: KfcOpsTokens.secondary),
              ),
            ),
          ],
        ),
      );
    }
    return Column(
      children: [
        for (final line in cart)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(line.emoji, style: const TextStyle(fontSize: 24)),
                const SizedBox(width: 9),
                Expanded(
                  child: Text(
                    line.name,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Text(
                  _money(line.price),
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _CheckoutSummary extends StatelessWidget {
  const _CheckoutSummary({required this.subtotal, required this.lift});

  final int subtotal;
  final double lift;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const Divider(),
        Row(
          children: [
            const Text(
              'Subtotal',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const Spacer(),
            Text(
              _money(subtotal),
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
            ),
          ],
        ),
        if (lift > 0) ...[
          const SizedBox(height: 7),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
            decoration: BoxDecoration(
              color: KfcOpsTokens.successContainer,
              borderRadius: BorderRadius.circular(99),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.trending_up_rounded,
                  size: 15,
                  color: KfcOpsTokens.success,
                ),
                const SizedBox(width: 4),
                Text(
                  '+${(lift * 100).toStringAsFixed(1)}% vs basket at first add',
                  style: const TextStyle(
                    color: KfcOpsTokens.success,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: subtotal == 0 ? null : () {},
            child: const Text('Review order'),
          ),
        ),
      ],
    );
  }
}

class _RailCartSummary extends StatelessWidget {
  const _RailCartSummary({
    required this.cart,
    required this.subtotal,
    required this.lift,
  });

  final List<_CartLine> cart;
  final int subtotal;
  final double lift;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      color: const Color(0xFF0D0C0C),
      child: Row(
        children: [
          const Icon(Icons.shopping_bag_rounded, color: Colors.white),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '${cart.length} items',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          if (lift > 0)
            Text(
              '+${(lift * 100).toStringAsFixed(1)}%',
              style: const TextStyle(
                color: Color(0xFF78D9A7),
                fontWeight: FontWeight.w900,
              ),
            ),
          const SizedBox(width: 12),
          Text(
            _money(subtotal),
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _EvidenceOverlay extends StatelessWidget {
  const _EvidenceOverlay({
    required this.stage,
    required this.endpoint,
    required this.events,
    required this.cartRevision,
    required this.cart,
    required this.subtotal,
    required this.lift,
    required this.onClose,
  });

  final _JourneyStage stage;
  final String endpoint;
  final List<_EvidenceEvent> events;
  final int cartRevision;
  final List<_CartLine> cart;
  final int subtotal;
  final double lift;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0x99000000),
      child: Align(
        alignment: Alignment.centerRight,
        child: Container(
          width: 520,
          height: double.infinity,
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 28),
          color: const Color(0xFF121415),
          child: SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Presenter evidence',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 22,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          Text(
                            'Not customer-facing · synthetic POC evidence',
                            style: TextStyle(
                              color: Color(0xFF9CA5A9),
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: onClose,
                      icon: const Icon(
                        Icons.close_rounded,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _EvidenceCard(
                  title: 'Current request boundary',
                  children: [
                    _EvidenceField('Endpoint', endpoint),
                    _EvidenceField('Journey stage', _stageLabel(stage)),
                    _EvidenceField('Cart revision', '$cartRevision'),
                    const _EvidenceField(
                      'Serving authority',
                      'Eligibility policy → automatic ranker',
                    ),
                    const _EvidenceField(
                      'Model revision',
                      'kfc-auto-lgbm-2026-07-poc',
                    ),
                    const _EvidenceField(
                      'Data provenance',
                      'Synthetic behavioral-world fixture',
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _MetricCard(
                        label: 'Basket',
                        value: _money(subtotal),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _MetricCard(
                        label: 'Relative lift',
                        value: lift > 0
                            ? '+${(lift * 100).toStringAsFixed(1)}%'
                            : '—',
                        positive: lift > 0,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _MetricCard(
                        label: 'Cart lines',
                        value: '${cart.length}',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                const Text(
                  'Decision and outcome timeline',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                Expanded(
                  child: ListView.builder(
                    itemCount: events.length,
                    itemBuilder: (context, index) {
                      final event = events[index];
                      return _TimelineEvent(
                        event: event,
                        index: index,
                        isLast: index == events.length - 1,
                      );
                    },
                  ),
                ),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF24282A),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Text(
                    'Evidence rule: these screens demonstrate the interaction '
                    'contract. They do not claim real KFC uplift or live model '
                    'performance.',
                    style: TextStyle(
                      color: Color(0xFFBBC3C7),
                      fontSize: 11,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EvidenceCard extends StatelessWidget {
  const _EvidenceCard({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1D2022),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF323638)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }
}

class _EvidenceField extends StatelessWidget {
  const _EvidenceField(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 112,
            child: Text(
              label,
              style: const TextStyle(color: Color(0xFF8F999E), fontSize: 10),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: Color(0xFFF0F2F3),
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.label,
    required this.value,
    this.positive = false,
  });

  final String label;
  final String value;
  final bool positive;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF1D2022),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(color: Color(0xFF8F999E), fontSize: 9),
          ),
          const SizedBox(height: 5),
          Text(
            value,
            style: TextStyle(
              color: positive ? const Color(0xFF74D4A4) : Colors.white,
              fontSize: 15,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _TimelineEvent extends StatelessWidget {
  const _TimelineEvent({
    required this.event,
    required this.index,
    required this.isLast,
  });

  final _EvidenceEvent event;
  final int index;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 28,
            child: Column(
              children: [
                Container(
                  width: 20,
                  height: 20,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: index == 0
                        ? KfcOpsTokens.primaryContainer
                        : const Color(0xFF363B3E),
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    '${index + 1}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(width: 1, color: const Color(0xFF363B3E)),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 15),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    event.label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    event.detail,
                    style: const TextStyle(
                      color: Color(0xFF9CA5A9),
                      fontSize: 10,
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _VariantSwitcher extends StatelessWidget {
  const _VariantSwitcher({
    required this.variant,
    required this.onPrevious,
    required this.onNext,
    required this.onSelected,
  });

  final _PrototypeVariant variant;
  final VoidCallback onPrevious;
  final VoidCallback onNext;
  final ValueChanged<_PrototypeVariant> onSelected;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF151515),
      borderRadius: BorderRadius.circular(18),
      elevation: 12,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              tooltip: 'Previous variant (←)',
              onPressed: onPrevious,
              icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
            ),
            for (final option in _PrototypeVariant.values)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 3),
                child: ChoiceChip(
                  selected: option == variant,
                  label: Text('${option.code} · ${option.title}'),
                  onSelected: (_) => onSelected(option),
                  selectedColor: KfcOpsTokens.primaryContainer,
                  backgroundColor: const Color(0xFF2B2B2B),
                  side: BorderSide.none,
                  labelStyle: TextStyle(
                    color: option == variant
                        ? Colors.white
                        : const Color(0xFFBFBFBF),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            IconButton(
              tooltip: 'Next variant (→)',
              onPressed: onNext,
              icon: const Icon(
                Icons.arrow_forward_rounded,
                color: Colors.white,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _stageLabel(_JourneyStage stage) => switch (stage) {
  _JourneyStage.starter => 'STARTER',
  _JourneyStage.modifier => 'MODIFIER UPSELL',
  _JourneyStage.crossSell => 'SMART CROSS-SELL',
  _JourneyStage.complete => 'COMPLETE',
};

String _money(int value) {
  final digits = value.toString();
  final chunks = <String>[];
  for (var end = digits.length; end > 0; end -= 3) {
    chunks.add(digits.substring((end - 3).clamp(0, end), end));
  }
  return '${chunks.reversed.join('.')}₫';
}
