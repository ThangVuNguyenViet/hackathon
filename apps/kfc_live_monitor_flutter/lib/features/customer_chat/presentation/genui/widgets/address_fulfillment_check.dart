import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'genui_widget_chrome.dart';

class AddressFulfillmentCheck extends StatefulWidget {
  const AddressFulfillmentCheck({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  State<AddressFulfillmentCheck> createState() =>
      _AddressFulfillmentCheckState();
}

class _AddressFulfillmentCheckState extends State<AddressFulfillmentCheck> {
  static const _requiredFields = [
    'recipientName',
    'phone',
    'addressLine',
    'communeName',
    'provinceName',
  ];

  late Map<String, Object?> _initialDraft;
  final Map<String, TextEditingController> _controllers = {};

  @override
  void initState() {
    super.initState();
    _resetDraft();
  }

  @override
  void didUpdateWidget(covariant AddressFulfillmentCheck oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.attachment.id != widget.attachment.id) _resetDraft();
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.attachment.data['addressDraft'] is! Map) {
      return _buildQuotedFulfillment();
    }
    final action = widget.attachment.actionableActions
        .where((candidate) => candidate.id == 'submit_address')
        .firstOrNull;
    return GenUiWidgetChrome(
      attachment: widget.attachment,
      onAction: widget.onAction,
      accentColor: KfcOpsTokens.success,
      showActions: false,
      children: [
        if (_text(_initialDraft['rawAddress']).isNotEmpty) ...[
          const Text(
            'Địa chỉ bạn đã nhập',
            style: TextStyle(
              color: KfcOpsTokens.secondary,
              fontSize: 11,
              fontWeight: FontWeight.w700,
              height: 14 / 11,
            ),
          ),
          const SizedBox(height: KfcOpsTokens.spacingXs),
          Text(
            _text(_initialDraft['rawAddress']),
            style: const TextStyle(
              color: KfcOpsTokens.onSurface,
              fontSize: 13,
              fontWeight: FontWeight.w600,
              height: 18 / 13,
            ),
          ),
          const SizedBox(height: KfcOpsTokens.spacingMd),
        ],
        if (_missingFields.isNotEmpty) ...[
          const Text(
            'Còn thiếu thông tin giao hàng',
            style: TextStyle(
              color: KfcOpsTokens.critical,
              fontSize: 12,
              fontWeight: FontWeight.w700,
              height: 16 / 12,
            ),
          ),
          const SizedBox(height: KfcOpsTokens.spacingSm),
        ],
        _field(
          field: 'recipientName',
          label: 'Người nhận',
          placeholder: 'Nguyễn Văn An',
          autofillHints: const [AutofillHints.name],
        ),
        _field(
          field: 'phone',
          label: 'Số điện thoại',
          placeholder: '0901 234 567',
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
        ),
        _field(
          field: 'addressLine',
          label: 'Số nhà, đường, tòa nhà',
          placeholder: '54/2 Nguyễn Hồng Đào',
          autofillHints: const [AutofillHints.streetAddressLine1],
        ),
        _field(
          field: 'communeName',
          label: 'Phường / xã',
          placeholder: 'Phường Tân Bình',
          autofillHints: const [AutofillHints.addressCityAndState],
        ),
        _field(
          field: 'provinceName',
          label: 'Tỉnh / thành phố',
          placeholder: 'Thành phố Hồ Chí Minh',
          autofillHints: const [AutofillHints.addressState],
        ),
        _field(
          field: 'deliveryInstructions',
          label: 'Hướng dẫn giao hàng (không bắt buộc)',
          placeholder: 'Ví dụ: gọi khi đến, giao ở lễ tân',
          required: false,
          multiline: true,
        ),
        if (action != null) ...[
          const SizedBox(height: KfcOpsTokens.spacingSm),
          GenUiActionButton(
            attachment: widget.attachment,
            action: action,
            enabled: _isComplete,
            onPressed: _submit,
          ),
        ],
      ],
    );
  }

  Widget _buildQuotedFulfillment() {
    final fulfillment = genUiMap(widget.attachment.data['fulfillment']);
    final rawAddress = widget.attachment.data['address'];
    final address = genUiMap(rawAddress);
    return GenUiWidgetChrome(
      attachment: widget.attachment,
      onAction: widget.onAction,
      accentColor: KfcOpsTokens.success,
      children: [
        Text(
          rawAddress is String && rawAddress.trim().isNotEmpty
              ? rawAddress
              : _addressText(address),
          style: const TextStyle(
            color: KfcOpsTokens.onSurface,
            fontSize: 13,
            fontWeight: FontWeight.w600,
            height: 18 / 13,
            letterSpacing: 0,
          ),
        ),
        const SizedBox(height: KfcOpsTokens.spacingSm),
        GenUiMetricRow(
          label: 'Cửa hàng',
          value: genUiText(fulfillment['storeName'], fallback: 'Đang chọn'),
        ),
        GenUiMetricRow(
          label: 'ETA',
          value: '${genUiText(fulfillment['etaMinutes'], fallback: '--')} phút',
          valueColor: KfcOpsTokens.success,
        ),
        GenUiMetricRow(
          label: 'Phí giao hàng',
          value: moneyVnd(fulfillment['feeVnd']),
        ),
      ],
    );
  }

  Widget _field({
    required String field,
    required String label,
    required String placeholder,
    bool required = true,
    bool multiline = false,
    TextInputType? keyboardType,
    Iterable<String> autofillHints = const <String>[],
  }) {
    final missing = required && _missingFields.contains(field);
    final labelWidget = Text(
      '$label${required ? ' *' : ''}',
      key: missing
          ? CustomerChatKeys.genUiAddressMissingField(
              widget.attachment.id,
              field,
            )
          : null,
      style: TextStyle(
        color: missing ? KfcOpsTokens.critical : KfcOpsTokens.onSurface,
        fontSize: 12,
        fontWeight: FontWeight.w700,
        height: 16 / 12,
      ),
    );
    final input = ShadInput(
      key: CustomerChatKeys.genUiAddressField(widget.attachment.id, field),
      controller: _controllers[field],
      placeholder: Text(placeholder),
      keyboardType: keyboardType,
      textCapitalization: field == 'phone'
          ? TextCapitalization.none
          : TextCapitalization.sentences,
      autofillHints: autofillHints,
      maxLines: multiline ? 3 : 1,
      minLines: multiline ? 2 : null,
      onChanged: (_) => setState(() {}),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          labelWidget,
          const SizedBox(height: KfcOpsTokens.spacingXs),
          input,
        ],
      ),
    );
  }

  Set<String> get _missingFields => {
    for (final field in _requiredFields)
      if ((_controllers[field]?.text.trim() ?? '').isEmpty) field,
  };

  bool get _isComplete =>
      _missingFields.isEmpty &&
      widget.attachment.actionableActions.any(
        (action) => action.id == 'submit_address',
      );

  void _submit() {
    if (!_isComplete) return;
    final payload = <String, Object?>{
      'provinceCode': null,
      'communeCode': null,
      'deliveryInstructions': null,
      'rawAddress': null,
      'legacyDistrictText': null,
      for (final field in _requiredFields)
        field: _controllers[field]!.text.trim(),
    };
    final deliveryInstructions = _controllers['deliveryInstructions']!.text
        .trim();
    if (deliveryInstructions.isNotEmpty) {
      payload['deliveryInstructions'] = deliveryInstructions;
    }
    _retainVerifiedCode(
      payload: payload,
      nameField: 'communeName',
      codeField: 'communeCode',
    );
    _retainVerifiedCode(
      payload: payload,
      nameField: 'provinceName',
      codeField: 'provinceCode',
    );
    final rawAddress = _text(_initialDraft['rawAddress']);
    if (rawAddress.isNotEmpty) payload['rawAddress'] = rawAddress;
    final legacyDistrict = _text(_initialDraft['legacyDistrictText']);
    if (legacyDistrict.isNotEmpty) {
      payload['legacyDistrictText'] = legacyDistrict;
    }
    final action = widget.attachment.bindAction(
      actionId: 'submit_address',
      payload: payload,
    );
    if (action != null) widget.onAction(action);
  }

  void _retainVerifiedCode({
    required Map<String, Object?> payload,
    required String nameField,
    required String codeField,
  }) {
    final initialName = _text(_initialDraft[nameField]);
    final currentName = _controllers[nameField]!.text.trim();
    final code = _text(_initialDraft[codeField]);
    if (currentName == initialName && code.isNotEmpty) {
      payload[codeField] = code;
    }
  }

  void _resetDraft() {
    final draft = genUiMap(widget.attachment.data['addressDraft']);
    _initialDraft = draft;
    final values = <String, String>{
      for (final field in [..._requiredFields, 'deliveryInstructions'])
        field: _text(draft[field]),
    };
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    _controllers
      ..clear()
      ..addAll({
        for (final entry in values.entries)
          entry.key: TextEditingController(text: entry.value),
      });
  }

  String _addressText(Map<String, Object?> address) {
    final parts = [address['line1'], address['district'], address['city']]
        .map((part) => genUiText(part, fallback: ''))
        .where((part) => part.isNotEmpty)
        .toList(growable: false);
    return parts.isEmpty ? 'Chưa có địa chỉ' : parts.join(', ');
  }
}

String _text(Object? value) => value is String ? value.trim() : '';
