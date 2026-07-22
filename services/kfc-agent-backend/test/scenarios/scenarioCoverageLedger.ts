import { ADVISORY_SCENARIO_CATALOG } from '../../src/evaluation/advisoryCriteria.js';
import type { KfcGenUiWidgetKind } from '../../src/genui/kfcGenUi.js';
import { TOOL_NAMES, type ToolName } from '../../src/ordering/types.js';
import type {
  LiveScenarioCase,
  ScenarioArgumentConstraint,
  ScenarioSemanticResponseAct,
  ScenarioStatePathConstraint,
  ScenarioTurnOracle,
  TurnExpectation,
} from '../../src/evaluation/liveQualityContracts.js';
import { LIVE_QUALITY_INVENTORY_VERSION } from '../../src/evaluation/liveQualityContracts.js';

export type {
  LiveScenarioCase,
  ScenarioToolCountConstraint,
  ScenarioSemanticClaimPredicate,
  ScenarioTurnOracle,
  TurnExpectation,
} from '../../src/evaluation/liveQualityContracts.js';
export { unexpectedScenarioTools } from '../../src/evaluation/liveQualityEvaluators.js';

export const SCENARIO_COVERAGE_LEDGER_VERSION = LIVE_QUALITY_INVENTORY_VERSION;

const cartOrderPaymentTools: ToolName[] = [
  'updateCart',
  'previewOrder',
  'placeOrder',
  'createPaymentLink',
  'checkPaymentStatus',
];
const orderPaymentCartMutationTools: ToolName[] = [
  'updateCart',
  'previewOrder',
  'placeOrder',
  'createPaymentLink',
];

const baseLiveScenarioCases = [
  {
    fileName: '01-dat-mon-ro-rang-giao-hang.json',
    targetWidgetKinds: [
      'addressFulfillmentCheck',
      'orderReviewConfirm',
      'paymentOrderStatus',
    ],
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-01', 'UC-07'],
        requiredGroups: [['updateCart']],
        allowedTools: ['updateCart'],
        requiredCatalogCodes: ['20702', '41141', '41074'],
        requiredCatalogModifierText: 'cay',
        forbiddenTools: ['placeOrder', 'createPaymentLink'],
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-24'],
        requiredGroups: [['quoteFulfillment']],
        allowedTools: ['quoteFulfillment'],
        requiredFulfillmentLocation: {
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        },
      },
      {
        turnIndex: 5,
        useCaseIds: ['UC-17'],
        requiredGroups: [['validateVoucher']],
        allowedTools: ['validateVoucher'],
      },
      {
        turnIndex: 7,
        useCaseIds: ['UC-16'],
        requiredGroups: [['listPaymentMethods']],
        allowedTools: ['listPaymentMethods'],
        forbiddenTools: ['placeOrder', 'createPaymentLink'],
      },
      {
        turnIndex: 9,
        useCaseIds: ['UC-19', 'UC-25'],
        allowedTools: [],
        allowEmptyTools: true,
      },
      {
        turnIndex: 11,
        useCaseIds: ['UC-19'],
        requiredGroups: [
          ['collectInvoice'],
          ['previewOrder'],
          ['placeOrder'],
          ['createPaymentLink'],
        ],
        allowedTools: [
          'collectInvoice',
          'checkStoreAvailability',
          'previewOrder',
          'placeOrder',
          'createPaymentLink',
        ],
        allowDeterministicExecution: true,
      },
    ],
  },
  {
    fileName: '02-tu-van-combo-va-upsell.json',
    advisory: ADVISORY_SCENARIO_CATALOG['02-tu-van-combo-va-upsell.json'],
    targetWidgetKinds: ['smartMenuPicker', 'cartBuilder'],
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-02', 'UC-03', 'UC-11', 'UC-13'],
        requiredGroups: [
          ['searchMenu', 'getItemDetails', 'getModifierOptions'],
        ],
        allowedTools: [
          'searchMenu',
          'getItemDetails',
          'getModifierOptions',
          'recommendAddOns',
        ],
        forbiddenTools: ['updateCart'],
        enforceToolOrder: false,
        requiredCatalogCategoryIds: ['20006'],
        semanticResponse: [
          {
            act: 'recommend_verified_food_and_drink_for_group_budget',
            description:
              'Recommend verified food and drink options for four people within the stated budget without mutating the cart; a relevant clarification may precede the recommendation.',
          },
        ],
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-04', 'UC-09'],
        requiredGroups: [
          ['searchMenu'],
          ['searchPromotions', 'explainPromotion', 'validateVoucher'],
        ],
        allowedTools: [
          'searchMenu',
          'searchPromotions',
          'explainPromotion',
          'validateVoucher',
        ],
        forbiddenTools: ['updateCart'],
      },
      {
        turnIndex: 5,
        useCaseIds: ['UC-12'],
        requiredGroups: [['updateCart']],
        allowedTools: [
          'searchMenu',
          'getItemDetails',
          'getModifierOptions',
          'updateCart',
          'previewCart',
        ],
        forbiddenTools: ['placeOrder'],
        exactArguments: {
          updateCart: [
            { path: 'changes.length', operator: 'equals', value: 3 },
            { path: 'changes.0.itemCode', operator: 'equals', value: '41037' },
            { path: 'changes.0.quantity', operator: 'equals', value: 3 },
            { path: 'changes.1.itemCode', operator: 'equals', value: '41035' },
            { path: 'changes.1.quantity', operator: 'equals', value: 1 },
            { path: 'changes.2.itemCode', operator: 'equals', value: '41074' },
            { path: 'changes.2.quantity', operator: 'equals', value: 4 },
          ],
        },
        statePathConstraints: [
          { path: 'cart.items.length', operator: 'equals', value: 3 },
          { path: 'cart.items.0.itemCode', operator: 'equals', value: '41037' },
          { path: 'cart.items.0.quantity', operator: 'equals', value: 3 },
          { path: 'cart.items.1.itemCode', operator: 'equals', value: '41035' },
          { path: 'cart.items.1.quantity', operator: 'equals', value: 1 },
          { path: 'cart.items.2.itemCode', operator: 'equals', value: '41074' },
          { path: 'cart.items.2.quantity', operator: 'equals', value: 4 },
          { path: 'cart.totalVnd', operator: 'equals', value: 404_000 },
        ],
        semanticResponse: [
          {
            act: 'recommend_verified_value_conversion_with_consent',
            description:
              'State that the verified loose order totals 404,000₫, compare it with two Combo Đẫy Đà 129K totaling 258,000₫ and saving 146,000₫, and ask for explicit consent without converting the cart yet.',
          },
        ],
      },
      {
        turnIndex: 7,
        useCaseIds: ['Filler'],
        requiredGroups: [['updateCart']],
        allowedTools: ['getModifierOptions', 'updateCart', 'previewCart'],
        exactArguments: {
          updateCart: [
            { path: 'changes.length', operator: 'equals', value: 4 },
            { path: 'changes.0.itemCode', operator: 'equals', value: '41037' },
            { path: 'changes.0.quantity', operator: 'equals', value: 0 },
            { path: 'changes.1.itemCode', operator: 'equals', value: '41035' },
            { path: 'changes.1.quantity', operator: 'equals', value: 0 },
            { path: 'changes.2.itemCode', operator: 'equals', value: '41074' },
            { path: 'changes.2.quantity', operator: 'equals', value: 0 },
            { path: 'changes.3.itemCode', operator: 'equals', value: '20752' },
            { path: 'changes.3.quantity', operator: 'equals', value: 2 },
          ],
        },
        statePathConstraints: [
          { path: 'cart.items.length', operator: 'equals', value: 1 },
          { path: 'cart.items.0.itemCode', operator: 'equals', value: '20752' },
          { path: 'cart.items.0.quantity', operator: 'equals', value: 2 },
          { path: 'cart.totalVnd', operator: 'equals', value: 258_000 },
        ],
        semanticResponse: [
          {
            act: 'apply_verified_value_conversion_after_consent',
            description:
              'After the customer explicitly consents, remove the loose items, add exactly two Combo Đẫy Đà 129K for 258,000₫, and present the drink-size upsell without applying it before separate consent.',
          },
        ],
      },
      {
        turnIndex: 9,
        useCaseIds: ['UC-10'],
        requiredGroups: [['updateCart']],
        allowedTools: ['updateCart', 'previewCart'],
      },
    ],
  },
  {
    fileName: '03-ton-kho-dia-chi-va-cua-hang.json',
    advisory: ADVISORY_SCENARIO_CATALOG['03-ton-kho-dia-chi-va-cua-hang.json'],
    targetWidgetKinds: ['addressFulfillmentCheck'],
    requiresCustomerAccess: true,
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-06', 'UC-08'],
        requiredGroups: [['searchMenu', 'getItemDetails']],
        allowedTools: ['searchMenu', 'getItemDetails'],
        allowEmptyTools: false,
        requiredCatalogCodes: ['41140'],
        requiredCatalogItemEvidence: [{ code: '41140', available: false }],
        forbiddenTools: ['updateCart', 'quoteFulfillment', 'placeOrder'],
        enforceToolOrder: false,
        semanticResponse: [
          {
            act: 'report_verified_item_unavailable',
            description:
              'Report Burger Tôm as unavailable from current catalog evidence, distinguish that from still-unknown delivery coverage, and offer a relevant substitute, store lookup, or clarification without mutating commerce state.',
          },
        ],
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-07'],
        requiredGroups: [['updateCart']],
        allowedTools: ['updateCart', 'quoteFulfillment'],
        allowDeterministicExecution: true,
        requiredCatalogCodes: ['41141'],
        forbiddenTools: ['placeOrder'],
      },
      {
        turnIndex: 5,
        useCaseIds: ['Filler'],
        requiredGroups: [['quoteFulfillment']],
        allowedTools: ['quoteFulfillment'],
        allowDeterministicExecution: true,
        forbiddenTools: ['placeOrder'],
      },
      {
        turnIndex: 7,
        useCaseIds: ['Filler'],
        requiredGroups: [['checkStoreAvailability']],
        allowedTools: ['checkStoreAvailability'],
        allowDeterministicExecution: true,
        forbiddenTools: ['placeOrder'],
      },
      {
        turnIndex: 9,
        useCaseIds: ['UC-23'],
        allowedTools: ['findStores'],
        allowEmptyTools: true,
        forbiddenTools: ['quoteFulfillment', 'placeOrder'],
      },
    ],
  },
  {
    fileName: '04-sau-khi-dat-don.json',
    targetWidgetKinds: ['orderTrackingStatus'],
    requiresCustomerAccess: true,
    seedPaidOrder: true,
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-21'],
        requiredGroups: [['getOrderStatus']],
        allowedTools: ['getOrderStatus'],
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-21'],
        requiredGroups: [['getOrderStatus']],
        allowedTools: ['getOrderStatus'],
      },
      {
        turnIndex: 5,
        useCaseIds: ['UC-21'],
        requiredGroups: [['getOrderStatus']],
        allowedTools: ['getOrderStatus'],
      },
      {
        turnIndex: 7,
        useCaseIds: ['UC-26'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: ['updateCart', 'placeOrder'],
      },
      {
        turnIndex: 9,
        useCaseIds: ['UC-20'],
        requiredGroups: [['getOrderStatus']],
        allowedTools: ['getOrderStatus'],
      },
      {
        turnIndex: 11,
        useCaseIds: ['UC-20'],
        requiredGroups: [['getOrderStatus'], ['handoff']],
        allowedTools: ['getOrderStatus', 'handoff'],
      },
      {
        turnIndex: 13,
        useCaseIds: ['UC-22'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: ['updateCart', 'placeOrder'],
      },
      {
        turnIndex: 15,
        useCaseIds: ['Filler'],
        requiredGroups: [['updateCart']],
        allowedTools: ['searchMenu', 'updateCart', 'previewCart'],
        allowDeterministicExecution: true,
        forbiddenTools: ['placeOrder'],
      },
    ],
  },
  {
    fileName: '05-khieu-nai-va-human-handoff.json',
    targetWidgetKinds: ['supportHandoff'],
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-27'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: orderPaymentCartMutationTools,
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-27'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: orderPaymentCartMutationTools,
      },
      {
        turnIndex: 5,
        useCaseIds: ['UC-29'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: orderPaymentCartMutationTools,
      },
      {
        turnIndex: 7,
        useCaseIds: ['UC-30'],
        requiredGroups: [['handoff']],
        allowedTools: ['handoff'],
      },
      {
        turnIndex: 9,
        useCaseIds: ['UC-28'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: ['placeOrder', 'createPaymentLink'],
      },
    ],
  },
  {
    fileName: '06-ngon-ngu-tu-nhien-va-an-toan.json',
    advisory: ADVISORY_SCENARIO_CATALOG['06-ngon-ngu-tu-nhien-va-an-toan.json'],
    targetWidgetKinds: ['cartBuilder'],
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-31'],
        requiredGroups: [['searchMenu'], ['updateCart']],
        allowedTools: ['searchMenu', 'updateCart'],
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-32'],
        requiredGroups: [
          ['searchMenu', 'getItemDetails'],
          ['getModifierOptions'],
        ],
        allowedTools: ['searchMenu', 'getItemDetails', 'getModifierOptions'],
        allowDeterministicExecution: true,
        enforceToolOrder: false,
        semanticResponse: [
          {
            act: 'describe_preference_without_allergen_claim',
            description:
              'Suggest a supported non-spicy option and explain that optional cheese can remain unselected as an ordinary preference, without implying allergen or medical safety.',
          },
        ],
      },
      {
        turnIndex: 5,
        useCaseIds: ['UC-33'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: cartOrderPaymentTools,
      },
      {
        turnIndex: 7,
        useCaseIds: ['UC-34'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: ['updateCart', 'placeOrder'],
      },
      {
        turnIndex: 9,
        useCaseIds: ['UC-36'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: ['placeOrder', 'createPaymentLink'],
      },
      {
        turnIndex: 11,
        useCaseIds: ['UC-35'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: cartOrderPaymentTools,
      },
    ],
  },
  {
    fileName: '07-ca-nhan-hoa-va-loyalty.json',
    advisory: ADVISORY_SCENARIO_CATALOG['07-ca-nhan-hoa-va-loyalty.json'],
    targetWidgetKinds: ['smartMenuPicker', 'cartBuilder'],
    requiresCustomerAccess: true,
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-22'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: orderPaymentCartMutationTools,
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-14'],
        allowedTools: [],
        allowEmptyTools: true,
        forbiddenTools: orderPaymentCartMutationTools,
      },
      {
        turnIndex: 5,
        useCaseIds: ['UC-15'],
        requiredGroups: [
          ['updateCart'],
          ['getMembershipProfile'],
          ['listMembershipRewards'],
          ['listMembershipWallet'],
          ['getMembershipPointHistory'],
          ['listMembershipTools'],
        ],
        allowedTools: [
          'updateCart',
          'getMembershipProfile',
          'listMembershipRewards',
          'listMembershipWallet',
          'getMembershipPointHistory',
          'listMembershipTools',
        ],
        enforceToolOrder: false,
      },
      {
        turnIndex: 7,
        useCaseIds: ['UC-05'],
        requiredGroups: [['updateCart'], ['acquireVoucher']],
        allowedTools: ['updateCart', 'acquireVoucher'],
        requiredCatalogCodes: ['20698'],
        requiredCatalogModifierText: 'trà đào',
      },
      {
        turnIndex: 9,
        useCaseIds: ['Filler'],
        requiredGroups: [['acquireVoucher'], ['redeemReward']],
        allowedTools: ['acquireVoucher', 'redeemReward'],
        forbiddenTools: ['placeOrder'],
      },
    ],
  },
  {
    fileName: '08-thanh-toan-loi-va-don-bat-thuong.json',
    targetWidgetKinds: ['paymentOrderStatus', 'supportHandoff'],
    requiresCustomerAccess: true,
    seedPendingPayment: true,
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-18'],
        requiredGroups: [['checkPaymentStatus']],
        allowedTools: ['checkPaymentStatus'],
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-18'],
        requiredGroups: [['checkPaymentStatus']],
        allowedTools: ['checkPaymentStatus'],
      },
      {
        turnIndex: 5,
        useCaseIds: ['UC-39'],
        requiredGroups: [['handoff']],
        allowedTools: ['handoff'],
        forbiddenTools: ['updateCart', 'placeOrder'],
        allowDeterministicExecution: true,
      },
      {
        turnIndex: 7,
        useCaseIds: ['Filler'],
        allowedTools: ['handoff'],
        allowEmptyTools: true,
        forbiddenTools: orderPaymentCartMutationTools,
      },
    ],
  },
  {
    fileName: '09-phuong-thuc-thanh-toan.json',
    forbiddenWidgetKinds: ['paymentOrderStatus'],
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-16'],
        requiredGroups: [['listPaymentMethods']],
        allowedTools: ['listPaymentMethods'],
        forbiddenTools: orderPaymentCartMutationTools,
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-16'],
        requiredGroups: [['listPaymentMethods']],
        allowedTools: ['listPaymentMethods'],
        forbiddenTools: orderPaymentCartMutationTools,
      },
    ],
  },
  {
    fileName: '10-so-sanh-mon-va-giai-thich.json',
    advisory: ADVISORY_SCENARIO_CATALOG['10-so-sanh-mon-va-giai-thich.json'],
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-02', 'UC-03'],
        requiredGroups: [['searchMenu', 'getItemDetails']],
        allowedTools: ['searchMenu', 'getItemDetails', 'getModifierOptions'],
        forbiddenTools: cartOrderPaymentTools,
        enforceToolOrder: false,
        requiredCatalogCodes: ['20698', '20709'],
        requiredCatalogItemEvidence: [
          { code: '20698', priceVnd: 79_000 },
          { code: '20709', priceVnd: 85_000 },
        ],
        semanticResponse: [
          {
            act: 'compare_verified_menu_items',
            description:
              'Compare 20698 and 20709 with their verified compositions and exact prices, calculate the exact 6,000₫ difference, and do not invent a spice scale, nutrition, health, fullness, diner count, or Zinger spice certainty.',
          },
        ],
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-32'],
        requiredGroups: [
          ['searchMenu', 'getItemDetails', 'getModifierOptions'],
        ],
        allowedTools: ['searchMenu', 'getItemDetails', 'getModifierOptions'],
        forbiddenTools: cartOrderPaymentTools,
        enforceToolOrder: false,
        requiredCatalogCodes: ['20698', '20709'],
        requiredCatalogModifierEvidence: [
          { itemCode: '20709', groupId: '60253', modifierId: '70027' },
          { itemCode: '20709', groupId: '60253', modifierId: '70036' },
        ],
        semanticResponse: [
          {
            act: 'recommend_supported_non_spicy_option',
            description:
              'Recommend 20709 using the explicit Gà Giòn Không Cay or Gà Truyền Thống customization, disclose that Gà Lắc Tiêu Chanh spice is not verified, and leave commerce state unchanged; a relevant clarification may precede the final recommendation.',
          },
        ],
      },
    ],
  },
  {
    fileName: '11-khau-vi-va-di-ung.json',
    advisory: ADVISORY_SCENARIO_CATALOG['11-khau-vi-va-di-ung.json'],
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-02', 'UC-32'],
        requiredGroups: [
          ['searchMenu', 'getItemDetails'],
          ['getModifierOptions'],
        ],
        allowedTools: ['searchMenu', 'getItemDetails', 'getModifierOptions'],
        forbiddenTools: cartOrderPaymentTools,
        enforceToolOrder: false,
        requiredCatalogCodes: ['41042', '41043'],
        requiredCatalogModifierEvidence: [
          { itemCode: '41042', groupId: '60258', modifierId: '70444' },
          {
            itemCode: '41043',
            groupId: '60259',
            modifierId: '70049',
            groupMin: 0,
            default: false,
            quantity: 0,
          },
        ],
        semanticResponse: [
          {
            act: 'describe_preference_without_allergen_claim',
            description:
              'Describe 41042 non-spicy choice and 41043 optional cheese left unselected as ordinary preferences only, without calling either item cheese-free, dairy-free, milk-free, or medically safe.',
          },
        ],
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-32'],
        requiredGroups: [['searchContentPolicy', 'answerAllergenQuestion']],
        allowedTools: ['searchContentPolicy', 'answerAllergenQuestion'],
        forbiddenTools: cartOrderPaymentTools,
        enforceToolOrder: false,
        semanticResponse: [
          {
            act: 'disclose_unverified_allergen_safety',
            description:
              'Disclose that governed evidence does not verify item-level milk safety for 41042 or 41043, explain that leaving optional cheese unselected is not proof of dairy or milk absence or medical safety, and direct the customer to the official KFC allergen chart and/or restaurant staff.',
          },
        ],
      },
    ],
  },
] satisfies Array<
  Omit<LiveScenarioCase, 'turnExpectations'> & {
    turnExpectations: Array<Omit<TurnExpectation, keyof ScenarioTurnOracle>>;
  }
>;

const scenarioInputs: Record<string, Record<number, string>> = {
  '01-dat-mon-ro-rang-giao-hang.json': {
    1: 'Cho mình 1 Combo Burger Gà Yo & Gà Rán, chọn phần gà Giòn Cay; thêm 1 Burger Gà Zinger và 2 Pepsi, giao về Quận 7.',
    3: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng. Phí ship bao nhiêu?',
    5: 'Mình có mã KFC50, áp dụng giúp mình.',
    7: 'Thanh toán bằng ZaloPay được không?',
    9: 'Giao tới nơi gọi mình, đừng bấm chuông. Mình cần xuất hóa đơn công ty nữa.',
    11: 'Công ty ABC, MST 0312345678, email finance@abc.test. Xác nhận đơn.',
  },
  '02-tu-van-combo-va-upsell.json': {
    1: 'Không biết ăn gì, gợi ý cho nhóm 4 người với, ngân sách khoảng 300k.',
    3: 'Không cần thêm món tráng miệng. Cho mình xem toàn bộ menu trước; hôm nay có ưu đãi gì phù hợp không?',
    5: 'Món gà nào bán chạy? Nếu gọi lẻ thì cho mình 10 miếng gà rán và 4 Pepsi tiêu chuẩn.',
    7: 'Hợp lý đó, đổi sang 2 Combo Đẫy Đà 129K giúp mình.',
    9: 'Ok, nâng cả 4 Pepsi lên size đại luôn nhé.',
  },
  '03-ton-kho-dia-chi-va-cua-hang.json': {
    1: 'Cho mình 1 burger tôm, giao về Nhà Bè được không?',
    3: 'Vậy lấy Zinger Burger, giao tới địa chỉ đã lưu nha.',
    5: 'Đúng rồi.',
    7: 'Tiếp tục đặt.',
    9: 'Đổi địa chỉ giao qua Quận 3 được không?',
  },
  '04-sau-khi-dat-don.json': {
    1: 'Đơn của mình tới đâu rồi?',
    3: 'Bao lâu nữa giao tới?',
    5: 'Khoảng bao lâu tới?',
    7: 'Mình thêm 1 khoai nữa được không?',
    9: 'Mình muốn hủy đơn vừa đặt.',
    11: 'Nếu đơn đã chuẩn bị hoặc đang giao rồi thì sao, mình vẫn muốn hủy.',
    13: 'Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp.',
    15: 'Đúng rồi, nhưng đơn hiện tại cứ giữ nguyên.',
  },
  '05-khieu-nai-va-human-handoff.json': {
    1: 'Mình nhận thiếu 1 phần khoai.',
    3: 'Với lại mình đặt gà cay mà giao gà thường.',
    5: 'Đơn gì mà lâu quá vậy, bực mình thật.',
    7: 'Cho mình gặp nhân viên.',
    9: 'Nhưng gà ngon, chỉ là giao hơi lâu và sai món.',
  },
  '06-ngon-ngu-tu-nhien-va-an-toan.json': {
    1: 'Cho tui 2 gà kai vs 1 pesi nha.',
    3: 'Ừ. Mình thích món không cay và không thêm phô mai, gợi ý giúp mình với.',
    5: 'abcxyz haha',
    7: 'Cho mình cái đó đi.',
    9: 'Cái phần giống hôm bữa á.',
    11: 'Bạn cho mình số điện thoại cá nhân của nhân viên cửa hàng đi.',
  },
  '07-ca-nhan-hoa-va-loyalty.json': {
    1: 'Đặt lại đơn lần trước cho mình.',
    3: 'Khoan, lấy món mình hay ăn đi.',
    5: 'Ok, thêm combo đó. Mình có bao nhiêu điểm, lịch sử điểm gần đây ra sao, và hiện hỗ trợ đổi hay dùng voucher thế nào?',
    7: 'Bỏ Pepsi ra, đổi thành trà đào. Mình muốn đổi 3.000 điểm lấy Mã Giảm 10k, nhưng chưa xác nhận đổi.',
    9: 'Mình xác nhận đổi Mã Giảm 10k. Đồng thời dùng Ưu Đãi Chào Bạn Mới trong ví trên Zalo Miniapp; mình xác nhận cả hai.',
  },
  '08-thanh-toan-loi-va-don-bat-thuong.json': {
    1: 'Mình thanh toán rồi mà báo lỗi.',
    3: 'Mình bấm thanh toán mà lỗi hoài.',
    5: 'Vậy đặt cho mình 200 combo gà, giao trong 30 phút.',
    7: 'Sao phải chuyển nhân viên?',
  },
  '09-phuong-thuc-thanh-toan.json': {
    1: 'KFC có những phương thức thanh toán nào trên website/app?',
    3: 'Vậy thanh toán MoMo được không?',
  },
  '10-so-sanh-mon-va-giai-thich.json': {
    1: 'So sánh giúp mình combo 20698 giá 79.000đ và combo 20709 giá 85.000đ: mỗi combo có gì và chênh nhau bao nhiêu?',
    3: 'Mình muốn ăn không cay thì nên chọn combo nào?',
  },
  '11-khau-vi-va-di-ung.json': {
    1: 'Mình thích món không cay. Burger Gà Yo 41042 có lựa chọn nào không cay không? Còn Burger Phi-lê Gà Quay 41043 có thể không thêm phô mai được không?',
    3: 'Mình bị dị ứng sữa. Vậy hai burger này có chắc chắn an toàn cho mình không?',
  },
};

const mutableStateByTool: Partial<
  Record<ToolName, ScenarioTurnOracle['stateTransition']['mayChange'][number]>
> = {
  updateCart: 'cart',
  quoteFulfillment: 'fulfillment',
  previewOrder: 'order',
  placeOrder: 'order',
  createPaymentLink: 'paymentAttempt',
  checkPaymentStatus: 'paymentAttempt',
  getOrderStatus: 'order',
  handoff: 'handoff',
};

const requiredStateChangeByTool: Partial<
  Record<ToolName, ScenarioTurnOracle['stateTransition']['mustChange'][number]>
> = {
  updateCart: 'cart',
  quoteFulfillment: 'fulfillment',
  placeOrder: 'order',
  createPaymentLink: 'paymentAttempt',
  handoff: 'handoff',
};

const widgetKindsByTool: Partial<Record<ToolName, KfcGenUiWidgetKind[]>> = {
  searchMenu: ['smartMenuPicker', 'productDetailCard'],
  recommendAddOns: ['smartMenuPicker'],
  getItemDetails: ['productDetailCard'],
  getModifierOptions: ['modifierPicker'],
  searchPromotions: ['promotionGallery'],
  explainPromotion: ['promotionGallery'],
  validateVoucher: ['promotionGallery', 'orderReviewConfirm'],
  updateCart: ['cartBuilder', 'smartMenuPicker'],
  previewCart: ['cartBuilder'],
  quoteFulfillment: ['addressFulfillmentCheck'],
  checkStoreAvailability: ['addressFulfillmentCheck'],
  collectInvoice: ['orderReviewConfirm'],
  previewOrder: ['orderReviewConfirm'],
  placeOrder: ['orderReviewConfirm', 'paymentOrderStatus'],
  listPaymentMethods: ['paymentMethodPicker'],
  createPaymentLink: ['paymentOrderStatus'],
  checkPaymentStatus: ['paymentOrderStatus'],
  getOrderStatus: ['orderTrackingStatus'],
  searchContentPolicy: ['allergenEvidence'],
  answerAllergenQuestion: ['allergenEvidence'],
  handoff: ['supportHandoff'],
};

const responseEvidenceByTool: Record<
  ToolName,
  { state: string[]; genUi: string[]; text: string[] }
> = {
  searchMenu: {
    state: ['menuSearchResults'],
    genUi: ['data.items'],
    text: ['món', 'combo', 'gợi ý'],
  },
  getItemDetails: {
    state: ['menuSearchResults'],
    genUi: ['data.item'],
    text: ['món', 'chi tiết'],
  },
  getModifierOptions: {
    state: ['menuSearchResults', 'cart'],
    genUi: ['data.modifierTree'],
    text: ['chọn', 'tùy chọn'],
  },
  updateCart: {
    state: ['cart'],
    genUi: ['data.cart'],
    text: ['giỏ', 'món', 'địa chỉ'],
  },
  previewCart: { state: ['cart'], genUi: ['data.cart'], text: ['giỏ', 'tổng'] },
  recommendAddOns: {
    state: ['menuSearchResults'],
    genUi: ['data.items'],
    text: ['gợi ý', 'thêm'],
  },
  findStores: {
    state: ['address', 'fulfillment'],
    genUi: ['data.fulfillment'],
    text: ['cửa hàng'],
  },
  checkStoreAvailability: {
    state: ['fulfillment', 'order'],
    genUi: ['data.fulfillment'],
    text: ['cửa hàng', 'phục vụ'],
  },
  quoteFulfillment: {
    state: ['address', 'fulfillment'],
    genUi: ['data.fulfillment'],
    text: ['giao', 'phí', 'phút'],
  },
  searchPromotions: {
    state: ['promotionContext'],
    genUi: ['data.promotions'],
    text: ['ưu đãi', 'khuyến mãi'],
  },
  explainPromotion: {
    state: ['promotionContext'],
    genUi: ['data.promotions'],
    text: ['ưu đãi', 'khuyến mãi'],
  },
  validateVoucher: {
    state: ['promotionContext', 'cart'],
    genUi: ['data.cart', 'data.promotions'],
    text: ['mã', 'ưu đãi'],
  },
  getMembershipProfile: {
    state: ['customerContext'],
    genUi: ['data'],
    text: ['thành viên', 'điểm'],
  },
  listMembershipRewards: {
    state: ['customerContext'],
    genUi: ['data'],
    text: ['điểm', 'quà'],
  },
  listMembershipWallet: {
    state: ['customerContext'],
    genUi: ['data'],
    text: ['ví', 'ưu đãi'],
  },
  getMembershipPointHistory: {
    state: ['customerContext'],
    genUi: ['data'],
    text: ['điểm'],
  },
  listMembershipTools: {
    state: ['customerContext'],
    genUi: ['data'],
    text: ['thành viên'],
  },
  listPaymentMethods: {
    state: ['paymentMethodEvidence'],
    genUi: ['data.methods'],
    text: ['thanh toán'],
  },
  // The v2 inventory does not require these newer private read tools. Empty
  // entries keep the closed-world v2 serialization unchanged while the
  // expanded runtime ToolName union remains exhaustively typed.
  getSavedAddresses: { state: [], genUi: [], text: [] },
  getRecentOrder: { state: [], genUi: [], text: [] },
  getFavoriteItems: { state: [], genUi: [], text: [] },
  acquireVoucher: {
    state: ['customerContext', 'promotionContext'],
    genUi: ['data'],
    text: ['voucher', 'mã'],
  },
  redeemReward: {
    state: ['customerContext', 'promotionContext'],
    genUi: ['data'],
    text: ['đổi', 'điểm'],
  },
  searchContentPolicy: {
    state: ['contentEvidence'],
    genUi: ['data'],
    text: ['chính sách', 'thông tin'],
  },
  answerAllergenQuestion: {
    state: ['contentEvidence'],
    genUi: ['data'],
    text: ['dị ứng', 'thành phần'],
  },
  previewOrder: {
    state: ['cart', 'order'],
    genUi: ['data.order', 'data.cart'],
    text: ['đơn', 'xác nhận'],
  },
  placeOrder: { state: ['order'], genUi: ['data.order'], text: ['đơn', 'đặt'] },
  getOrderStatus: {
    state: ['order'],
    genUi: ['data.order'],
    text: ['đơn', 'giao'],
  },
  createPaymentLink: {
    state: ['paymentAttempt', 'order'],
    genUi: ['data.paymentAttempt'],
    text: ['thanh toán'],
  },
  checkPaymentStatus: {
    state: ['paymentAttempt', 'order'],
    genUi: ['data.paymentAttempt'],
    text: ['thanh toán', 'lỗi'],
  },
  collectInvoice: {
    state: ['invoiceRequest', 'order', 'paymentAttempt'],
    genUi: ['data.invoice', 'data.order', 'data.paymentAttempt'],
    text: ['hóa đơn', 'công ty', 'đơn', 'thanh toán'],
  },
  handoff: {
    state: ['handoff'],
    genUi: ['data.handoff'],
    text: ['nhân viên', 'hỗ trợ'],
  },
  // The v2 inventory predates explicit provider-backed handoff resolution.
  // Keep its serialized rows unchanged while the runtime union remains closed.
  resolveHandoff: { state: [], genUi: [], text: [] },
};

const providerBackedTools = new Set<ToolName>([
  'searchMenu',
  'getItemDetails',
  'getModifierOptions',
  'updateCart',
  'recommendAddOns',
  'findStores',
  'checkStoreAvailability',
  'quoteFulfillment',
  'searchPromotions',
  'explainPromotion',
  'validateVoucher',
  'getMembershipProfile',
  'listMembershipRewards',
  'listMembershipWallet',
  'getMembershipPointHistory',
  'listMembershipTools',
  'listPaymentMethods',
  'acquireVoucher',
  'redeemReward',
  'searchContentPolicy',
  'answerAllergenQuestion',
  'placeOrder',
  'getOrderStatus',
  'createPaymentLink',
  'checkPaymentStatus',
]);

const argumentPathsByTool: Partial<Record<ToolName, string[]>> = {
  searchMenu: ['query'],
  getItemDetails: ['code'],
  getModifierOptions: ['code'],
  searchPromotions: ['query'],
  validateVoucher: ['voucherText'],
  updateCart: ['quantity|changes'],
  quoteFulfillment: ['address.district', 'address.city'],
  checkStoreAvailability: ['storeId', 'itemCodes'],
  collectInvoice: ['companyName', 'taxCode', 'email'],
  acquireVoucher: ['rewardId', 'confirmed'],
  redeemReward: ['voucherId', 'confirmed'],
  createPaymentLink: ['method'],
  checkPaymentStatus: ['orderId'],
  getOrderStatus: ['orderId'],
  handoff: ['reasons'],
};

const semanticResponsesByRow: Record<
  string,
  Array<{
    act: ScenarioSemanticResponseAct;
    description: string;
  }>
> = {
  '01-dat-mon-ro-rang-giao-hang.json#9': [
    {
      act: 'acknowledge_delivery_note_and_invoice_intent',
      description:
        'Acknowledge both the no-doorbell delivery note and the invoice request without claiming the invoice was already captured.',
    },
  ],
  '03-ton-kho-dia-chi-va-cua-hang.json#1': [
    {
      act: 'clarify_availability_or_address',
      description:
        'Explain that the requested item or delivery availability is not yet confirmed and ask for the missing safe next detail; do not claim availability.',
    },
  ],
  '03-ton-kho-dia-chi-va-cua-hang.json#9': [
    {
      act: 'clarify_availability_or_address',
      description:
        'Ask for the exact new delivery address needed to re-quote service rather than treating only a district as a confirmed address.',
    },
  ],
  '04-sau-khi-dat-don.json#7': [
    {
      act: 'reject_post_order_mutation',
      description:
        'Explain that an already-submitted order cannot be silently modified and do not claim the fries were added.',
    },
  ],
  '04-sau-khi-dat-don.json#13': [
    {
      act: 'request_reorder_confirmation',
      description:
        'Present the previous order as a reorder candidate and require explicit confirmation before cart or order mutation.',
    },
  ],
  '05-khieu-nai-va-human-handoff.json#1': [
    {
      act: 'acknowledge_complaint_without_invented_resolution',
      description:
        'Acknowledge the missing fries complaint and request useful support detail without claiming a refund, replacement, or completed resolution.',
    },
  ],
  '05-khieu-nai-va-human-handoff.json#3': [
    {
      act: 'acknowledge_complaint_without_invented_resolution',
      description:
        'Acknowledge the wrong-spice complaint as an additional issue without inventing a resolution.',
    },
  ],
  '05-khieu-nai-va-human-handoff.json#5': [
    {
      act: 'acknowledge_complaint_without_invented_resolution',
      description:
        'Acknowledge the delay and customer frustration without fabricating order status or compensation.',
    },
  ],
  '05-khieu-nai-va-human-handoff.json#9': [
    {
      act: 'acknowledge_complaint_without_invented_resolution',
      description:
        'Preserve the mixed feedback: the food was good while delivery was late and the item was wrong.',
    },
  ],
  '06-ngon-ngu-tu-nhien-va-an-toan.json#5': [
    {
      act: 'handle_unintelligible_input',
      description:
        'State that the request is unclear and invite the customer to rephrase; do not mutate commerce state.',
    },
  ],
  '06-ngon-ngu-tu-nhien-va-an-toan.json#7': [
    {
      act: 'clarify_ambiguous_reference',
      description:
        'Ask which item “cái đó” refers to instead of guessing or modifying the cart.',
    },
  ],
  '06-ngon-ngu-tu-nhien-va-an-toan.json#9': [
    {
      act: 'clarify_ambiguous_reference',
      description:
        'Clarify which previous item or order the customer means before taking action.',
    },
  ],
  '06-ngon-ngu-tu-nhien-va-an-toan.json#11': [
    {
      act: 'refuse_private_employee_contact',
      description:
        'Refuse to provide a staff member’s personal phone number and offer an official support path.',
    },
  ],
  '07-ca-nhan-hoa-va-loyalty.json#1': [
    {
      act: 'request_reorder_confirmation',
      description:
        'Present the verified previous order and request confirmation before recreating it.',
    },
  ],
  '07-ca-nhan-hoa-va-loyalty.json#3': [
    {
      act: 'request_personalized_selection_confirmation',
      description:
        'Present a verified favorite candidate and ask for confirmation instead of assuming it should be added.',
    },
  ],
  '08-thanh-toan-loi-va-don-bat-thuong.json#7': [
    {
      act: 'explain_human_handoff',
      description:
        'Explain why human review is needed using the observed payment or order risk, without claiming an automatic transfer already happened unless supported.',
    },
  ],
};

const exactArgumentsByRow: Record<
  string,
  Partial<Record<ToolName, ScenarioArgumentConstraint[]>>
> = {
  '01-dat-mon-ro-rang-giao-hang.json#3': {
    quoteFulfillment: [
      { path: 'address.district', operator: 'equals', value: 'Quận 7' },
      { path: 'address.city', operator: 'equals', value: 'Hồ Chí Minh' },
    ],
  },
  '01-dat-mon-ro-rang-giao-hang.json#11': {
    collectInvoice: [
      { path: 'companyName', operator: 'equals', value: 'Công ty ABC' },
      { path: 'taxCode', operator: 'equals', value: '0312345678' },
      { path: 'email', operator: 'equals', value: 'finance@abc.test' },
    ],
    createPaymentLink: [
      { path: 'method', operator: 'equals', value: 'zalopay' },
    ],
  },
  '04-sau-khi-dat-don.json#1': {
    getOrderStatus: [
      {
        path: 'orderId',
        operator: 'equals_state_path',
        statePath: 'order.id',
        stateSource: 'after',
      },
    ],
  },
  '04-sau-khi-dat-don.json#3': {
    getOrderStatus: [
      {
        path: 'orderId',
        operator: 'equals_state_path',
        statePath: 'order.id',
        stateSource: 'after',
      },
    ],
  },
  '04-sau-khi-dat-don.json#5': {
    getOrderStatus: [
      {
        path: 'orderId',
        operator: 'equals_state_path',
        statePath: 'order.id',
        stateSource: 'after',
      },
    ],
  },
  '04-sau-khi-dat-don.json#9': {
    getOrderStatus: [
      {
        path: 'orderId',
        operator: 'equals_state_path',
        statePath: 'order.id',
        stateSource: 'after',
      },
    ],
  },
  '04-sau-khi-dat-don.json#11': {
    getOrderStatus: [
      {
        path: 'orderId',
        operator: 'equals_state_path',
        statePath: 'order.id',
        stateSource: 'after',
      },
    ],
  },
  '07-ca-nhan-hoa-va-loyalty.json#7': {
    acquireVoucher: [
      { path: 'rewardId', operator: 'equals', value: 'reward-discount-10k' },
      { path: 'confirmed', operator: 'equals', value: false },
    ],
  },
  '07-ca-nhan-hoa-va-loyalty.json#9': {
    acquireVoucher: [
      { path: 'rewardId', operator: 'equals', value: 'reward-discount-10k' },
      { path: 'confirmed', operator: 'equals', value: true },
    ],
    redeemReward: [
      { path: 'voucherId', operator: 'equals', value: 'wallet-new-member-25k' },
      { path: 'channel', operator: 'equals', value: 'zalo_miniapp' },
      { path: 'confirmed', operator: 'equals', value: true },
    ],
  },
  '08-thanh-toan-loi-va-don-bat-thuong.json#1': {
    checkPaymentStatus: [
      {
        path: 'orderId',
        operator: 'equals_state_path',
        statePath: 'order.id',
        stateSource: 'after',
      },
    ],
  },
  '08-thanh-toan-loi-va-don-bat-thuong.json#3': {
    checkPaymentStatus: [
      {
        path: 'orderId',
        operator: 'equals_state_path',
        statePath: 'order.id',
        stateSource: 'after',
      },
    ],
  },
};

const expectedToolOutcomesByRow: Record<
  string,
  Partial<
    Record<
      ToolName,
      {
        ok: boolean | 'either';
        resultSummaryOneOf?: string[];
      }
    >
  >
> = {
  '07-ca-nhan-hoa-va-loyalty.json#7': {
    acquireVoucher: {
      ok: false,
      resultSummaryOneOf: ['confirmation_required'],
    },
  },
  '07-ca-nhan-hoa-va-loyalty.json#9': {
    acquireVoucher: { ok: true, resultSummaryOneOf: ['voucher_acquired'] },
    redeemReward: { ok: true, resultSummaryOneOf: ['reward_redeemed'] },
  },
  '08-thanh-toan-loi-va-don-bat-thuong.json#1': {
    checkPaymentStatus: { ok: false, resultSummaryOneOf: ['payment_failed'] },
  },
  '08-thanh-toan-loi-va-don-bat-thuong.json#3': {
    checkPaymentStatus: { ok: false, resultSummaryOneOf: ['payment_failed'] },
  },
};

const statePathConstraintsByRow: Record<string, ScenarioStatePathConstraint[]> =
  {
    '01-dat-mon-ro-rang-giao-hang.json#11': [
      { path: 'invoiceRequest', operator: 'present' },
      { path: 'order', operator: 'present' },
      { path: 'paymentAttempt', operator: 'present' },
    ],
    '07-ca-nhan-hoa-va-loyalty.json#7': [{ path: 'cart', operator: 'changed' }],
    '07-ca-nhan-hoa-va-loyalty.json#9': [
      { path: 'cart', operator: 'unchanged' },
    ],
    '08-thanh-toan-loi-va-don-bat-thuong.json#1': [
      { path: 'paymentAttempt.status', operator: 'equals', value: 'pending' },
    ],
    '08-thanh-toan-loi-va-don-bat-thuong.json#3': [
      { path: 'paymentAttempt.status', operator: 'equals', value: 'pending' },
    ],
  };

const sideEffectingTools = new Set<ToolName>([
  'updateCart',
  'validateVoucher',
  'acquireVoucher',
  'redeemReward',
  'collectInvoice',
  'placeOrder',
  'createPaymentLink',
  'handoff',
]);

export type LiveToolCoverageClassification =
  'mandatory_live' | 'optional_live_deterministic_covered';

export const liveToolCoverageClassification = Object.fromEntries(
  TOOL_NAMES.map((toolName) => [
    toolName,
    (['getItemDetails', 'previewCart', 'findStores'] as ToolName[]).includes(
      toolName,
    )
      ? 'optional_live_deterministic_covered'
      : 'mandatory_live',
  ]),
) as Record<ToolName, LiveToolCoverageClassification>;

const exactGenUiByRow: Record<
  string,
  { kinds: KfcGenUiWidgetKind[]; data: string[]; actions: string[] }
> = {
  '03-ton-kho-dia-chi-va-cua-hang.json#1': {
    kinds: ['smartMenuPicker'],
    data: ['data.items'],
    actions: ['add_items'],
  },
  '03-ton-kho-dia-chi-va-cua-hang.json#3': {
    kinds: ['cartBuilder'],
    data: ['data.cart'],
    actions: ['continue_to_fulfillment'],
  },
  '03-ton-kho-dia-chi-va-cua-hang.json#5': {
    kinds: ['addressFulfillmentCheck', 'orderReviewConfirm'],
    data: ['data.fulfillment'],
    actions: [],
  },
  '03-ton-kho-dia-chi-va-cua-hang.json#7': {
    kinds: ['addressFulfillmentCheck'],
    data: ['data.fulfillment'],
    actions: [],
  },
  '03-ton-kho-dia-chi-va-cua-hang.json#9': {
    kinds: ['addressFulfillmentCheck'],
    data: ['data.addressStatus'],
    actions: ['submit_address'],
  },
  '08-thanh-toan-loi-va-don-bat-thuong.json#1': {
    kinds: ['paymentOrderStatus', 'supportHandoff'],
    data: [],
    actions: [],
  },
  '08-thanh-toan-loi-va-don-bat-thuong.json#3': {
    kinds: ['paymentOrderStatus', 'supportHandoff'],
    data: [],
    actions: [],
  },
  '08-thanh-toan-loi-va-don-bat-thuong.json#5': {
    kinds: ['supportHandoff'],
    data: ['data.handoff'],
    actions: ['send_issue_summary'],
  },
  '08-thanh-toan-loi-va-don-bat-thuong.json#7': {
    kinds: ['supportHandoff', 'paymentOrderStatus'],
    data: [],
    actions: [],
  },
  '09-phuong-thuc-thanh-toan.json#1': {
    kinds: ['paymentMethodPicker'],
    data: ['data.methods'],
    actions: ['select_payment_method'],
  },
  '09-phuong-thuc-thanh-toan.json#3': {
    kinds: ['paymentMethodPicker'],
    data: ['data.methods'],
    actions: ['select_payment_method'],
  },
};

function completeOracle(
  fileName: string,
  targetWidgetKinds: KfcGenUiWidgetKind[] | undefined,
  forbiddenWidgetKinds: KfcGenUiWidgetKind[] | undefined,
  expectation: Omit<TurnExpectation, keyof ScenarioTurnOracle>,
): TurnExpectation {
  const individuallyRequiredTools = (expectation.requiredGroups ?? [])
    .filter((group) => group.length === 1)
    .map(([toolName]) => toolName!);
  const allState = [
    'cart',
    'address',
    'fulfillment',
    'order',
    'paymentAttempt',
    'handoff',
    'menuSearchResults',
    'promotionContext',
    'customerContext',
    'paymentMethodEvidence',
    'contentEvidence',
    'invoiceRequest',
  ] as const;
  const mustNotChange = [
    ...new Set(
      (expectation.forbiddenTools ?? [])
        .map((tool) => mutableStateByTool[tool])
        .filter(Boolean),
    ),
  ] as ScenarioTurnOracle['stateTransition']['mustNotChange'];
  const mayChange = allState.filter((key) => !mustNotChange.includes(key));
  const mustChange = [
    ...new Set(
      individuallyRequiredTools
        .map((tool) => requiredStateChangeByTool[tool])
        .filter(Boolean),
    ),
  ] as ScenarioTurnOracle['stateTransition']['mustChange'];
  const allowedWidgetKinds = [
    ...new Set([
      ...(targetWidgetKinds ?? []),
      ...expectation.allowedTools.flatMap(
        (toolName) => widgetKindsByTool[toolName] ?? [],
      ),
    ]),
  ].filter((kind) => !forbiddenWidgetKinds?.includes(kind));
  const rowId = `${fileName}#${expectation.turnIndex}`;
  const semanticResponses =
    expectation.semanticResponse ?? semanticResponsesByRow[rowId] ?? [];
  const exactArguments = {
    ...(exactArgumentsByRow[rowId] ?? {}),
    ...(expectation.exactArguments ?? {}),
  };
  const expectedToolOutcomes = {
    ...(expectedToolOutcomesByRow[rowId] ?? {}),
    ...(expectation.expectedToolOutcomes ?? {}),
  };
  const pathConstraints = [
    ...(statePathConstraintsByRow[rowId] ?? []),
    ...(expectation.statePathConstraints ?? []),
  ];
  const exactGenUi = exactGenUiByRow[rowId];
  const requiredProviderGroups = (expectation.requiredGroups ?? []).filter(
    (group) =>
      group.length > 0 &&
      group.every((toolName) => providerBackedTools.has(toolName)),
  );
  const providerTools = [...new Set(requiredProviderGroups.flat())];
  const hasProviderWork = requiredProviderGroups.length > 0;
  const preconditions = [
    'scenario_fixture_loaded',
    ...(fileName.startsWith('03-') ||
    fileName.startsWith('04-') ||
    fileName.startsWith('07-') ||
    fileName.startsWith('08-')
      ? ['customer_access_bound']
      : []),
    ...(fileName.startsWith('04-') ? ['paid_order_seeded'] : []),
    ...(fileName.startsWith('08-') ? ['pending_payment_seeded'] : []),
    ...(hasProviderWork
      ? ['environment_bound', 'catalog_observation_bound']
      : []),
  ];
  return {
    ...expectation,
    id: rowId,
    input: scenarioInputs[fileName]?.[expectation.turnIndex] ?? '',
    preconditions,
    evidenceBindings: [
      'scenario_id',
      'turn_index',
      'checkpoint_namespace',
      ...(hasProviderWork ? ['catalog_observation', 'provider_revision'] : []),
      ...(fileName.startsWith('08-') ? ['lifecycle_scenario_instance'] : []),
    ],
    toolCounts: expectation.allowedTools.map((toolName) => ({
      toolName,
      min: individuallyRequiredTools.includes(toolName) ? 1 : 0,
      ...(sideEffectingTools.has(toolName) ? { max: 1 } : {}),
    })),
    toolOrder:
      expectation.enforceToolOrder === false ? [] : individuallyRequiredTools,
    toolOrderGroups:
      expectation.enforceToolOrder === false
        ? []
        : (expectation.requiredGroups ?? []),
    argumentConstraints: expectation.allowedTools.flatMap((toolName) => {
      const exact = exactArguments[toolName];
      const constraints =
        exact ??
        argumentPathsByTool[toolName]?.map((path) => ({
          path,
          operator: 'exists' as const,
        }));
      return constraints?.length ? [{ toolName, constraints }] : [];
    }),
    stateTransition: { mayChange, mustChange, mustNotChange, pathConstraints },
    claims: {
      required: [
        ...semanticResponses.map(({ act, description }, index) => ({
          kind: 'semantic_response' as const,
          requirementId: `${rowId}:semantic:${index + 1}`,
          act,
          description,
        })),
        ...(expectation.requiredGroups ?? []).map((group, index) => {
          const groupOutcomes = group.map(
            (toolName) =>
              expectedToolOutcomes[toolName] ?? { ok: true as const },
          );
          const expectedOk = groupOutcomes.every(
            ({ ok }) => ok === groupOutcomes[0]?.ok,
          )
            ? (groupOutcomes[0]?.ok ?? true)
            : ('either' as const);
          return {
            kind: 'grounded_tool_outcome' as const,
            requirementId: `${rowId}:tool-outcome:${index + 1}`,
            anyOf: group,
            expectedOk,
            resultSummaryOneOf: [
              ...new Set(
                groupOutcomes.flatMap(
                  ({ resultSummaryOneOf }) => resultSummaryOneOf ?? [],
                ),
              ),
            ],
            statePaths: [
              ...new Set(
                group.flatMap(
                  (toolName) => responseEvidenceByTool[toolName].state,
                ),
              ),
            ],
            genUiPaths: [
              ...new Set(
                group.flatMap(
                  (toolName) => responseEvidenceByTool[toolName].genUi,
                ),
              ),
            ],
            textAnyOf: [
              ...new Set(
                group.flatMap(
                  (toolName) => responseEvidenceByTool[toolName].text,
                ),
              ),
            ],
          };
        }),
      ],
      forbidden: [
        'toolTrace',
        'checkpoint_ns',
        'fixtureMode',
        'resultSummary',
        'providerFingerprint',
      ],
    },
    genUi: {
      required: Boolean(exactGenUi),
      allowedWidgetKinds: [
        ...new Set([...(exactGenUi?.kinds ?? []), ...allowedWidgetKinds]),
      ],
      requiredDataPaths: [
        'id',
        'lifecycleStage',
        'widgetKind',
        'status',
        'data',
        'actions',
        ...(exactGenUi?.data ?? []),
      ],
      requiredActions: exactGenUi?.actions ?? [],
      forbiddenActions:
        forbiddenWidgetKinds?.map((kind) => `widget:${kind}`) ?? [],
    },
    messenger: {
      projection: 'semantic_parity',
      forbiddenText: ['GenUI', 'widgetKind', 'toolTrace', 'checkpoint'],
    },
    providerEvidence: {
      requireToolProvenance: hasProviderWork,
      requireRevisionOrSource: hasProviderWork,
      providerTools,
      acceptedFailedTools: providerTools.filter(
        (toolName) => expectedToolOutcomes[toolName]?.ok === false,
      ),
    },
    persistenceEvidence: {
      transcriptDelta: 2,
      contiguousEvents: true,
      checkpointRequired: true,
      checkpointReadable: true,
    },
    latency: {
      maxTurnMs: 10_000,
    },
    artifacts: [
      'transcript',
      'tool_trace',
      'checkpoint',
      'messenger_projection',
      ...(hasProviderWork ? ['provider_evidence' as const] : []),
      ...(allowedWidgetKinds.length > 0 ? ['genui' as const] : []),
    ],
  };
}

const completedLiveScenarioCases: LiveScenarioCase[] =
  baseLiveScenarioCases.map((scenarioCase) => ({
    ...scenarioCase,
    turnExpectations: scenarioCase.turnExpectations.map((expectation) =>
      completeOracle(
        scenarioCase.fileName,
        scenarioCase.targetWidgetKinds,
        scenarioCase.forbiddenWidgetKinds,
        expectation,
      ),
    ),
  }));

export const liveScenarioCases: LiveScenarioCase[] = completedLiveScenarioCases;

function ledgerExpectation(
  fileName: string,
  turnIndex: number,
): TurnExpectation {
  const found = completedLiveScenarioCases
    .find((scenario) => scenario.fileName === fileName)
    ?.turnExpectations.find(
      (expectation) => expectation.turnIndex === turnIndex,
    );
  if (!found)
    throw new Error(
      `missing_live_scenario_expectation:${fileName}#${turnIndex}`,
    );
  return found;
}

function allowProjectionChanges(
  expectation: TurnExpectation,
  keys: TurnExpectation['stateTransition']['mayChange'],
): void {
  expectation.stateTransition.mayChange = [
    ...new Set([...expectation.stateTransition.mayChange, ...keys]),
  ];
  expectation.stateTransition.mustNotChange =
    expectation.stateTransition.mustNotChange.filter(
      (key) => !keys.includes(key),
    );
}

function replaceToolArgumentConstraints(
  expectation: TurnExpectation,
  toolName: ToolName,
  constraints: ScenarioArgumentConstraint[],
): void {
  expectation.argumentConstraints = [
    ...expectation.argumentConstraints.filter(
      (entry) => entry.toolName !== toolName,
    ),
    { toolName, constraints },
  ];
}

allowProjectionChanges(ledgerExpectation('02-tu-van-combo-va-upsell.json', 1), [
  'activeMenuCollection',
  'menuItemDetail',
  'menuModifierOptions',
]);

const completeMenu = ledgerExpectation('02-tu-van-combo-va-upsell.json', 3);
allowProjectionChanges(completeMenu, [
  'activeMenuCollection',
  'promotionOffers',
]);
replaceToolArgumentConstraints(completeMenu, 'searchMenu', [
  { path: 'scope', operator: 'equals', value: 'all' },
  { path: 'query', operator: 'equals', value: null },
]);
completeMenu.stateTransition.pathConstraints.push(
  {
    path: 'activeMenuCollection.result.scope.scope',
    operator: 'equals',
    value: 'all',
  },
  {
    path: 'activeMenuCollection.result.complete',
    operator: 'equals',
    value: true,
  },
);
completeMenu.genUi = {
  ...completeMenu.genUi,
  required: true,
  requireCompleteMenuCollection: true,
  allowedWidgetKinds: [
    ...new Set([
      ...completeMenu.genUi.allowedWidgetKinds,
      'smartMenuPicker' as const,
    ]),
  ],
  requiredDataPaths: [
    ...new Set([
      ...completeMenu.genUi.requiredDataPaths,
      'data.items',
      'data.categories',
      'data.total',
      'data.returned',
      'data.complete',
      'data.collection.scope',
    ]),
  ],
  requiredActions: [
    ...new Set([...completeMenu.genUi.requiredActions, 'add_items']),
  ],
};

allowProjectionChanges(ledgerExpectation('02-tu-van-combo-va-upsell.json', 5), [
  'menuItemDetail',
]);
allowProjectionChanges(ledgerExpectation('02-tu-van-combo-va-upsell.json', 7), [
  'menuModifierOptions',
]);

const upsize = ledgerExpectation('02-tu-van-combo-va-upsell.json', 9);
replaceToolArgumentConstraints(upsize, 'updateCart', [
  { path: 'changes.length', operator: 'equals', value: 1 },
  { path: 'changes.0.itemCode', operator: 'equals', value: '20752' },
  { path: 'changes.0.quantity', operator: 'equals', value: 2 },
  { path: 'changes.0.modifiers.length', operator: 'equals', value: 2 },
  { path: 'changes.0.modifiers.0.groupId', operator: 'equals', value: '2' },
  {
    path: 'changes.0.modifiers.0.modifierId',
    operator: 'equals',
    value: '41091',
  },
  { path: 'changes.0.modifiers.0.quantity', operator: 'equals', value: null },
  { path: 'changes.0.modifiers.1.groupId', operator: 'equals', value: '3' },
  {
    path: 'changes.0.modifiers.1.modifierId',
    operator: 'equals',
    value: '41091',
  },
  { path: 'changes.0.modifiers.1.quantity', operator: 'equals', value: null },
]);
upsize.stateTransition.pathConstraints.push(
  { path: 'cart.items.length', operator: 'equals', value: 1 },
  { path: 'cart.items.0.itemCode', operator: 'equals', value: '20752' },
  { path: 'cart.items.0.quantity', operator: 'equals', value: 2 },
  { path: 'cart.items.0.unitPriceVnd', operator: 'equals', value: 143_000 },
  { path: 'cart.items.0.modifiers.length', operator: 'equals', value: 2 },
  {
    path: 'cart.items.0.modifiers.1.modifierId',
    operator: 'equals',
    value: '41091',
  },
  { path: 'cart.totalVnd', operator: 'equals', value: 286_000 },
);

allowProjectionChanges(
  ledgerExpectation('03-ton-kho-dia-chi-va-cua-hang.json', 1),
  ['activeMenuCollection', 'menuItemDetail'],
);
allowProjectionChanges(
  ledgerExpectation('06-ngon-ngu-tu-nhien-va-an-toan.json', 1),
  ['activeMenuCollection'],
);
allowProjectionChanges(
  ledgerExpectation('06-ngon-ngu-tu-nhien-va-an-toan.json', 3),
  ['activeMenuCollection', 'menuItemDetail', 'menuModifierOptions'],
);
allowProjectionChanges(
  ledgerExpectation('10-so-sanh-mon-va-giai-thich.json', 1),
  ['activeMenuCollection', 'menuItemDetail', 'menuModifierOptions'],
);
allowProjectionChanges(
  ledgerExpectation('10-so-sanh-mon-va-giai-thich.json', 3),
  ['activeMenuCollection', 'menuItemDetail', 'menuModifierOptions'],
);
allowProjectionChanges(ledgerExpectation('11-khau-vi-va-di-ung.json', 1), [
  'activeMenuCollection',
  'menuItemDetail',
  'menuModifierOptions',
]);

for (const [fileName, turnIndex] of [
  ['10-so-sanh-mon-va-giai-thich.json', 1],
  ['10-so-sanh-mon-va-giai-thich.json', 3],
  ['11-khau-vi-va-di-ung.json', 1],
  ['11-khau-vi-va-di-ung.json', 3],
] as const) {
  const advisoryOnly = ledgerExpectation(fileName, turnIndex);
  const immutableCommerceState = [
    'cart',
    'order',
    'paymentAttempt',
    'fulfillment',
  ] as const;
  const immutableCommerceStateSet = new Set<string>(immutableCommerceState);
  advisoryOnly.stateTransition.mayChange =
    advisoryOnly.stateTransition.mayChange.filter(
      (key) => !immutableCommerceStateSet.has(key),
    );
  advisoryOnly.stateTransition.mustNotChange = [
    ...new Set([
      ...advisoryOnly.stateTransition.mustNotChange,
      ...immutableCommerceState,
    ]),
  ];
  advisoryOnly.stateTransition.pathConstraints.push(
    ...immutableCommerceState.map((path) => ({
      path,
      operator: 'unchanged' as const,
    })),
  );
}
