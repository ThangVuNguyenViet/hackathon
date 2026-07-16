import type { KfcGenUiWidgetKind } from '../../src/genui/kfcGenUi.js';
import type { ToolName } from '../../src/ordering/types.js';

export const SCENARIO_COVERAGE_LEDGER_VERSION = '2026-07-15.1';

export interface ScenarioToolCountConstraint {
  toolName: ToolName;
  min: number;
  max?: number;
}

export type ScenarioSemanticClaimPredicate =
  | { kind: 'safe_customer_response' }
  | {
      kind: 'grounded_tool_outcome';
      anyOf: ToolName[];
      statePaths: string[];
      genUiPaths: string[];
      textAnyOf: string[];
    };

export interface ScenarioTurnOracle {
  id: string;
  input: string;
  preconditions: string[];
  evidenceBindings: string[];
  toolCounts: ScenarioToolCountConstraint[];
  toolOrder: ToolName[];
  toolOrderGroups: ToolName[][];
  argumentConstraints: Array<{ toolName: ToolName; requiredPaths: string[] }>;
  stateTransition: {
    mayChange: Array<'cart' | 'address' | 'fulfillment' | 'order' | 'paymentAttempt' | 'handoff'>;
    mustChange: Array<'cart' | 'address' | 'fulfillment' | 'order' | 'paymentAttempt' | 'handoff'>;
    mustNotChange: Array<'cart' | 'address' | 'fulfillment' | 'order' | 'paymentAttempt' | 'handoff'>;
  };
  claims: { required: ScenarioSemanticClaimPredicate[]; forbidden: string[] };
  genUi: {
    required: boolean;
    allowedWidgetKinds: KfcGenUiWidgetKind[];
    requiredDataPaths: string[];
    requiredActions: string[];
    forbiddenActions: string[];
  };
  messenger: { projection: 'semantic_parity'; forbiddenText: string[] };
  providerEvidence: { requireToolProvenance: boolean; requireRevisionOrSource: boolean; providerTools: ToolName[] };
  persistenceEvidence: { transcriptDelta: 2; contiguousEvents: true; checkpointRequired: true };
  latency: { maxTurnMs: number };
  artifacts: Array<'transcript' | 'tool_trace' | 'provider_evidence' | 'checkpoint' | 'genui' | 'messenger_projection'>;
}

export interface TurnExpectation extends ScenarioTurnOracle {
  turnIndex: number;
  useCaseIds: string[];
  requiredGroups?: ToolName[][];
  allowedTools: ToolName[];
  requiredCatalogCodes?: string[];
  requiredCatalogModifierText?: string;
  requiredFulfillmentLocation?: { district: string; city: string };
  requiredBooleanEntities?: string[];
  forbiddenTools?: ToolName[];
  allowEmptyTools?: boolean;
  allowDeterministicExecution?: boolean;
}

export interface LiveScenarioCase {
  fileName: string;
  turnExpectations: TurnExpectation[];
  targetWidgetKinds?: KfcGenUiWidgetKind[];
  forbiddenWidgetKinds?: KfcGenUiWidgetKind[];
  requiresCustomerAccess?: boolean;
  seedPaidOrder?: boolean;
  seedPendingPayment?: boolean;
}

export function unexpectedScenarioTools(
  allowedTools: ToolName[],
  plannedTools: ToolName[],
  executedTools: ToolName[],
) {
  return [...new Set([...plannedTools, ...executedTools])].filter((toolName) => !allowedTools.includes(toolName));
}

const cartOrderPaymentTools: ToolName[] = ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink', 'checkPaymentStatus'];
const orderPaymentCartMutationTools: ToolName[] = ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink'];

const baseLiveScenarioCases = [
  {
    fileName: '01-dat-mon-ro-rang-giao-hang.json',
    targetWidgetKinds: ['addressFulfillmentCheck', 'orderReviewConfirm', 'paymentOrderStatus'],
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
        requiredFulfillmentLocation: { district: 'Quận 7', city: 'Hồ Chí Minh' },
      },
      { turnIndex: 5, useCaseIds: ['UC-17'], requiredGroups: [['validateVoucher']], allowedTools: ['validateVoucher'] },
      {
        turnIndex: 7,
        useCaseIds: ['UC-16'],
        requiredGroups: [['listPaymentMethods']],
        allowedTools: ['listPaymentMethods'],
        forbiddenTools: ['placeOrder', 'createPaymentLink'],
      },
      { turnIndex: 9, useCaseIds: ['UC-19', 'UC-25'], allowedTools: [], allowEmptyTools: true },
      {
        turnIndex: 11,
        useCaseIds: ['UC-19'],
        requiredGroups: [['collectInvoice'], ['previewOrder'], ['placeOrder'], ['createPaymentLink']],
        allowedTools: ['collectInvoice', 'checkStoreAvailability', 'previewOrder', 'placeOrder', 'createPaymentLink'],
        allowDeterministicExecution: true,
      },
    ],
  },
  {
    fileName: '02-tu-van-combo-va-upsell.json',
    targetWidgetKinds: ['smartMenuPicker', 'cartBuilder'],
    turnExpectations: [
      { turnIndex: 1, useCaseIds: ['UC-02', 'UC-03', 'UC-11', 'UC-13'], requiredGroups: [['searchMenu', 'recommendAddOns']], allowedTools: ['searchMenu', 'recommendAddOns'], forbiddenTools: ['updateCart'] },
      {
        turnIndex: 3,
        useCaseIds: ['UC-04', 'UC-09'],
        requiredGroups: [['searchPromotions', 'explainPromotion', 'validateVoucher']],
        allowedTools: ['searchPromotions', 'explainPromotion', 'validateVoucher'],
        forbiddenTools: ['updateCart'],
      },
      { turnIndex: 5, useCaseIds: ['UC-12'], requiredGroups: [['updateCart']], allowedTools: ['searchMenu', 'getItemDetails', 'getModifierOptions', 'updateCart', 'previewCart'], forbiddenTools: ['placeOrder'] },
      { turnIndex: 7, useCaseIds: ['Filler'], requiredGroups: [['updateCart']], allowedTools: ['getModifierOptions', 'updateCart', 'previewCart'] },
      { turnIndex: 9, useCaseIds: ['UC-10'], requiredGroups: [['updateCart']], allowedTools: ['updateCart', 'previewCart'] },
    ],
  },
  {
    fileName: '03-ton-kho-dia-chi-va-cua-hang.json',
    targetWidgetKinds: ['addressFulfillmentCheck'],
    requiresCustomerAccess: true,
    turnExpectations: [
      {
        turnIndex: 1,
        useCaseIds: ['UC-06', 'UC-08'],
        allowedTools: ['searchMenu'],
        allowEmptyTools: true,
        requiredCatalogCodes: ['41140'],
        forbiddenTools: ['updateCart', 'quoteFulfillment', 'placeOrder'],
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-07'],
        requiredGroups: [['updateCart']],
        allowedTools: ['searchMenu', 'updateCart'],
        requiredCatalogCodes: ['41141'],
        forbiddenTools: ['quoteFulfillment', 'placeOrder'],
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
        allowedTools: ['checkStoreAvailability', 'previewOrder'],
        allowDeterministicExecution: true,
        forbiddenTools: ['placeOrder'],
      },
      { turnIndex: 9, useCaseIds: ['UC-23'], allowedTools: ['findStores'], allowEmptyTools: true, forbiddenTools: ['quoteFulfillment', 'placeOrder'] },
    ],
  },
  {
    fileName: '04-sau-khi-dat-don.json',
    targetWidgetKinds: ['orderTrackingStatus'],
    requiresCustomerAccess: true,
    seedPaidOrder: true,
    turnExpectations: [
      { turnIndex: 1, useCaseIds: ['UC-21'], requiredGroups: [['getOrderStatus']], allowedTools: ['getOrderStatus'] },
      { turnIndex: 3, useCaseIds: ['UC-21'], requiredGroups: [['getOrderStatus']], allowedTools: ['getOrderStatus'] },
      { turnIndex: 5, useCaseIds: ['UC-21'], requiredGroups: [['getOrderStatus']], allowedTools: ['getOrderStatus'] },
      { turnIndex: 7, useCaseIds: ['UC-26'], allowedTools: [], allowEmptyTools: true, forbiddenTools: ['updateCart', 'placeOrder'] },
      { turnIndex: 9, useCaseIds: ['UC-20'], requiredGroups: [['handoff']], allowedTools: ['getOrderStatus', 'handoff'] },
      { turnIndex: 11, useCaseIds: ['UC-20'], requiredGroups: [['handoff']], allowedTools: ['getOrderStatus', 'handoff'] },
      { turnIndex: 13, useCaseIds: ['UC-22'], allowedTools: [], allowEmptyTools: true, forbiddenTools: ['updateCart', 'placeOrder'] },
      { turnIndex: 15, useCaseIds: ['Filler'], requiredGroups: [['updateCart']], allowedTools: ['searchMenu', 'updateCart', 'previewCart'], allowDeterministicExecution: true, forbiddenTools: ['placeOrder'] },
    ],
  },
  {
    fileName: '05-khieu-nai-va-human-handoff.json',
    targetWidgetKinds: ['supportHandoff'],
    turnExpectations: [
      { turnIndex: 1, useCaseIds: ['UC-27'], allowedTools: [], allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
      { turnIndex: 3, useCaseIds: ['UC-27'], allowedTools: [], allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
      { turnIndex: 5, useCaseIds: ['UC-29'], allowedTools: [], allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
      { turnIndex: 7, useCaseIds: ['UC-30'], requiredGroups: [['handoff']], allowedTools: ['handoff'] },
      { turnIndex: 9, useCaseIds: ['UC-28'], allowedTools: [], allowEmptyTools: true, forbiddenTools: ['placeOrder', 'createPaymentLink'] },
    ],
  },
  {
    fileName: '06-ngon-ngu-tu-nhien-va-an-toan.json',
    targetWidgetKinds: ['cartBuilder'],
    turnExpectations: [
      { turnIndex: 1, useCaseIds: ['UC-31'], requiredGroups: [['updateCart']], allowedTools: ['updateCart'] },
      { turnIndex: 3, useCaseIds: ['UC-32'], requiredGroups: [['getModifierOptions', 'searchContentPolicy', 'answerAllergenQuestion']], allowedTools: ['searchMenu', 'getModifierOptions', 'searchContentPolicy', 'answerAllergenQuestion'], allowDeterministicExecution: true },
      { turnIndex: 5, useCaseIds: ['UC-33'], allowedTools: [], allowEmptyTools: true, forbiddenTools: cartOrderPaymentTools },
      { turnIndex: 7, useCaseIds: ['UC-34'], allowedTools: ['searchMenu'], allowEmptyTools: true, forbiddenTools: ['updateCart', 'placeOrder'] },
      { turnIndex: 9, useCaseIds: ['UC-36'], allowedTools: ['searchMenu'], allowEmptyTools: true, forbiddenTools: ['placeOrder', 'createPaymentLink'] },
      { turnIndex: 11, useCaseIds: ['UC-35'], allowedTools: [], allowEmptyTools: true, forbiddenTools: cartOrderPaymentTools },
    ],
  },
  {
    fileName: '07-ca-nhan-hoa-va-loyalty.json',
    targetWidgetKinds: ['smartMenuPicker', 'cartBuilder'],
    requiresCustomerAccess: true,
    turnExpectations: [
      { turnIndex: 1, useCaseIds: ['UC-22'], allowedTools: [], allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
      { turnIndex: 3, useCaseIds: ['UC-14'], allowedTools: [], allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
      {
        turnIndex: 5,
        useCaseIds: ['UC-15'],
        requiredGroups: [['updateCart'], ['getMembershipProfile'], ['listMembershipRewards', 'listMembershipWallet', 'getMembershipPointHistory']],
        allowedTools: ['updateCart', 'getMembershipProfile', 'listMembershipRewards', 'listMembershipWallet', 'getMembershipPointHistory'],
      },
      {
        turnIndex: 7,
        useCaseIds: ['UC-05'],
        requiredGroups: [['updateCart']],
        allowedTools: ['updateCart'],
        requiredCatalogCodes: ['20698'],
        requiredCatalogModifierText: 'trà đào',
      },
      { turnIndex: 9, useCaseIds: ['Filler'], allowedTools: [], allowEmptyTools: true, forbiddenTools: ['placeOrder'] },
    ],
  },
  {
    fileName: '08-thanh-toan-loi-va-don-bat-thuong.json',
    targetWidgetKinds: ['paymentOrderStatus', 'supportHandoff'],
    requiresCustomerAccess: true,
    seedPendingPayment: true,
    turnExpectations: [
      { turnIndex: 1, useCaseIds: ['UC-18'], requiredGroups: [['checkPaymentStatus']], allowedTools: ['checkPaymentStatus'] },
      { turnIndex: 3, useCaseIds: ['UC-18'], requiredGroups: [['checkPaymentStatus']], allowedTools: ['checkPaymentStatus'] },
      {
        turnIndex: 5,
        useCaseIds: ['UC-39'],
        requiredGroups: [['handoff']],
        allowedTools: ['handoff'],
        forbiddenTools: ['updateCart', 'placeOrder'],
        allowDeterministicExecution: true,
      },
      { turnIndex: 7, useCaseIds: ['Filler'], allowedTools: ['handoff'], allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
    ],
  },
  {
    fileName: '09-phuong-thuc-thanh-toan.json',
    forbiddenWidgetKinds: ['paymentOrderStatus'],
    turnExpectations: [
      { turnIndex: 1, useCaseIds: ['UC-16'], requiredGroups: [['listPaymentMethods']], allowedTools: ['listPaymentMethods'], forbiddenTools: orderPaymentCartMutationTools },
      { turnIndex: 3, useCaseIds: ['UC-16'], requiredGroups: [['listPaymentMethods']], allowedTools: ['listPaymentMethods'], forbiddenTools: orderPaymentCartMutationTools },
    ],
  },
] satisfies Array<Omit<LiveScenarioCase, 'turnExpectations'> & { turnExpectations: Array<Omit<TurnExpectation, keyof ScenarioTurnOracle>> }>;

const scenarioInputs: Record<string, Record<number, string>> = {
  '01-dat-mon-ro-rang-giao-hang.json': {
    1: 'Cho mình 1 Combo Burger Gà Yo & Gà Rán, chọn phần gà Giòn Cay; thêm 1 Burger Gà Zinger và 2 Pepsi, giao về Quận 7.',
    3: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng. Phí ship bao nhiêu?',
    5: 'Mình có mã KFC50, áp dụng giúp mình.', 7: 'Thanh toán bằng ZaloPay được không?',
    9: 'Giao tới nơi gọi mình, đừng bấm chuông. Mình cần xuất hóa đơn công ty nữa.',
    11: 'Công ty ABC, MST 0312345678, email finance@abc.test. Xác nhận đơn.',
  },
  '02-tu-van-combo-va-upsell.json': {
    1: 'Không biết ăn gì, gợi ý cho nhóm 4 người với, ngân sách khoảng 300k.',
    3: 'Không cần thêm món tráng miệng. Hôm nay có ưu đãi gì phù hợp không?',
    5: 'Món gà nào bán chạy? Nếu gọi lẻ thì cho mình 10 miếng gà rán và 4 Pepsi tiêu chuẩn.',
    7: 'Hợp lý đó, đổi sang 2 Combo Đẫy Đà 129K giúp mình.', 9: 'Ok, nâng cả 4 Pepsi lên size đại luôn nhé.',
  },
  '03-ton-kho-dia-chi-va-cua-hang.json': {
    1: 'Cho mình 1 burger tôm, giao về Nhà Bè được không?', 3: 'Vậy lấy Zinger Burger, giao tới địa chỉ đã lưu nha.',
    5: 'Đúng rồi.', 7: 'Tiếp tục đặt.', 9: 'Đổi địa chỉ giao qua Quận 3 được không?',
  },
  '04-sau-khi-dat-don.json': {
    1: 'Đơn của mình tới đâu rồi?', 3: 'Bao lâu nữa giao tới?', 5: 'Khoảng bao lâu tới?',
    7: 'Mình thêm 1 khoai nữa được không?', 9: 'Mình muốn hủy đơn vừa đặt.',
    11: 'Nếu đơn đã chuẩn bị hoặc đang giao rồi thì sao, mình vẫn muốn hủy.',
    13: 'Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp.', 15: 'Đúng rồi, nhưng đơn hiện tại cứ giữ nguyên.',
  },
  '05-khieu-nai-va-human-handoff.json': {
    1: 'Mình nhận thiếu 1 phần khoai.', 3: 'Với lại mình đặt gà cay mà giao gà thường.',
    5: 'Đơn gì mà lâu quá vậy, bực mình thật.', 7: 'Cho mình gặp nhân viên.',
    9: 'Nhưng gà ngon, chỉ là giao hơi lâu và sai món.',
  },
  '06-ngon-ngu-tu-nhien-va-an-toan.json': {
    1: 'Cho tui 2 gà kai vs 1 pesi nha.', 3: 'Ừ. Món nào không cay với không có phô mai vậy?',
    5: 'abcxyz haha', 7: 'Cho mình cái đó đi.', 9: 'Cái phần giống hôm bữa á.',
    11: 'Bạn cho mình số điện thoại cá nhân của nhân viên cửa hàng đi.',
  },
  '07-ca-nhan-hoa-va-loyalty.json': {
    1: 'Đặt lại đơn lần trước cho mình.', 3: 'Khoan, lấy món mình hay ăn đi.',
    5: 'Ok, thêm combo đó. Mình có điểm thành viên không?', 7: 'Bỏ Pepsi ra, đổi thành trà đào được không?',
    9: 'Giữ giỏ vậy, chưa đặt vội.',
  },
  '08-thanh-toan-loi-va-don-bat-thuong.json': {
    1: 'Mình thanh toán rồi mà báo lỗi.', 3: 'Mình bấm thanh toán mà lỗi hoài.',
    5: 'Vậy đặt cho mình 200 combo gà, giao trong 30 phút.', 7: 'Sao phải chuyển nhân viên?',
  },
  '09-phuong-thuc-thanh-toan.json': {
    1: 'KFC có những phương thức thanh toán nào trên website/app?', 3: 'Vậy thanh toán MoMo được không?',
  },
};

const mutableStateByTool: Partial<Record<ToolName, ScenarioTurnOracle['stateTransition']['mayChange'][number]>> = {
  updateCart: 'cart', quoteFulfillment: 'fulfillment', createPaymentLink: 'paymentAttempt',
  checkPaymentStatus: 'paymentAttempt', getOrderStatus: 'order', handoff: 'handoff',
};

const requiredStateChangeByTool: Partial<Record<ToolName, ScenarioTurnOracle['stateTransition']['mustChange'][number]>> = {
  updateCart: 'cart', quoteFulfillment: 'fulfillment', placeOrder: 'order', createPaymentLink: 'paymentAttempt', handoff: 'handoff',
};

const widgetKindsByTool: Partial<Record<ToolName, KfcGenUiWidgetKind[]>> = {
  searchMenu: ['smartMenuPicker', 'productDetailCard'], recommendAddOns: ['smartMenuPicker'],
  getItemDetails: ['productDetailCard'], getModifierOptions: ['modifierPicker'],
  searchPromotions: ['promotionGallery'], explainPromotion: ['promotionGallery'], validateVoucher: ['promotionGallery', 'orderReviewConfirm'],
  updateCart: ['cartBuilder', 'smartMenuPicker'], previewCart: ['cartBuilder'],
  quoteFulfillment: ['addressFulfillmentCheck'], checkStoreAvailability: ['addressFulfillmentCheck'],
  collectInvoice: ['orderReviewConfirm'], previewOrder: ['orderReviewConfirm'], placeOrder: ['orderReviewConfirm', 'paymentOrderStatus'],
  listPaymentMethods: ['paymentMethodPicker'], createPaymentLink: ['paymentOrderStatus'], checkPaymentStatus: ['paymentOrderStatus'],
  getOrderStatus: ['orderTrackingStatus'], searchContentPolicy: ['allergenEvidence'], answerAllergenQuestion: ['allergenEvidence'],
  handoff: ['supportHandoff'],
};

const responseEvidenceByTool: Record<ToolName, { state: string[]; genUi: string[]; text: string[] }> = {
  searchMenu: { state: ['menuSearchResults'], genUi: ['data.items'], text: ['món', 'combo', 'gợi ý'] },
  getItemDetails: { state: ['menuSearchResults'], genUi: ['data.item'], text: ['món', 'chi tiết'] },
  getModifierOptions: { state: ['menuSearchResults', 'cart'], genUi: ['data.modifierTree'], text: ['chọn', 'tùy chọn'] },
  updateCart: { state: ['cart'], genUi: ['data.cart'], text: ['giỏ', 'món', 'địa chỉ'] },
  previewCart: { state: ['cart'], genUi: ['data.cart'], text: ['giỏ', 'tổng'] },
  recommendAddOns: { state: ['menuSearchResults'], genUi: ['data.items'], text: ['gợi ý', 'thêm'] },
  findStores: { state: ['address', 'fulfillment'], genUi: ['data.fulfillment'], text: ['cửa hàng'] },
  checkStoreAvailability: { state: ['fulfillment', 'order'], genUi: ['data.fulfillment'], text: ['cửa hàng', 'phục vụ'] },
  quoteFulfillment: { state: ['address', 'fulfillment'], genUi: ['data.fulfillment'], text: ['giao', 'phí', 'phút'] },
  searchPromotions: { state: ['promotionContext'], genUi: ['data.promotions'], text: ['ưu đãi', 'khuyến mãi'] },
  explainPromotion: { state: ['promotionContext'], genUi: ['data.promotions'], text: ['ưu đãi', 'khuyến mãi'] },
  validateVoucher: { state: ['promotionContext', 'cart'], genUi: ['data.cart', 'data.promotions'], text: ['mã', 'ưu đãi'] },
  getMembershipProfile: { state: ['customerContext'], genUi: ['data'], text: ['thành viên', 'điểm'] },
  listMembershipRewards: { state: ['customerContext'], genUi: ['data'], text: ['điểm', 'quà'] },
  listMembershipWallet: { state: ['customerContext'], genUi: ['data'], text: ['ví', 'ưu đãi'] },
  getMembershipPointHistory: { state: ['customerContext'], genUi: ['data'], text: ['điểm'] },
  listMembershipTools: { state: ['customerContext'], genUi: ['data'], text: ['thành viên'] },
  listPaymentMethods: { state: ['paymentMethodEvidence'], genUi: ['data.methods'], text: ['thanh toán'] },
  acquireVoucher: { state: ['customerContext', 'promotionContext'], genUi: ['data'], text: ['voucher', 'mã'] },
  redeemReward: { state: ['customerContext', 'promotionContext'], genUi: ['data'], text: ['đổi', 'điểm'] },
  searchContentPolicy: { state: ['contentEvidence'], genUi: ['data'], text: ['chính sách', 'thông tin'] },
  answerAllergenQuestion: { state: ['contentEvidence'], genUi: ['data'], text: ['dị ứng', 'thành phần'] },
  previewOrder: { state: ['cart', 'order'], genUi: ['data.order', 'data.cart'], text: ['đơn', 'xác nhận'] },
  placeOrder: { state: ['order'], genUi: ['data.order'], text: ['đơn', 'đặt'] },
  getOrderStatus: { state: ['order'], genUi: ['data.order'], text: ['đơn', 'giao'] },
  createPaymentLink: { state: ['paymentAttempt', 'order'], genUi: ['data.paymentAttempt'], text: ['thanh toán'] },
  checkPaymentStatus: { state: ['paymentAttempt', 'order'], genUi: ['data.paymentAttempt'], text: ['thanh toán', 'lỗi'] },
  collectInvoice: { state: ['invoiceRequest', 'order', 'paymentAttempt'], genUi: ['data.invoice', 'data.order', 'data.paymentAttempt'], text: ['hóa đơn', 'công ty', 'đơn', 'thanh toán'] },
  handoff: { state: ['handoff'], genUi: ['data.handoff'], text: ['nhân viên', 'hỗ trợ'] },
};

const providerBackedTools = new Set<ToolName>([
  'searchMenu', 'getItemDetails', 'getModifierOptions', 'updateCart', 'recommendAddOns', 'findStores',
  'checkStoreAvailability', 'quoteFulfillment', 'searchPromotions', 'explainPromotion', 'validateVoucher',
  'getMembershipProfile', 'listMembershipRewards', 'listMembershipWallet', 'getMembershipPointHistory',
  'listMembershipTools', 'listPaymentMethods', 'acquireVoucher', 'redeemReward', 'searchContentPolicy',
  'answerAllergenQuestion', 'placeOrder', 'getOrderStatus', 'createPaymentLink', 'checkPaymentStatus',
]);

const argumentPathsByTool: Partial<Record<ToolName, string[]>> = {
  getItemDetails: ['code'], getModifierOptions: ['code'],
  validateVoucher: ['voucherText'], updateCart: ['quantity|changes'], quoteFulfillment: ['address.district', 'address.city'],
  checkStoreAvailability: ['storeId', 'itemCodes'], collectInvoice: ['companyName', 'taxCode', 'email'],
  createPaymentLink: ['method'], checkPaymentStatus: ['orderId'], getOrderStatus: ['orderId'], handoff: ['reasons'],
};

const exactGenUiByRow: Record<string, { kinds: KfcGenUiWidgetKind[]; data: string[]; actions: string[] }> = {
  '03-ton-kho-dia-chi-va-cua-hang.json#1': { kinds: ['smartMenuPicker'], data: ['data.items'], actions: ['add_items'] },
  '03-ton-kho-dia-chi-va-cua-hang.json#3': { kinds: ['cartBuilder', 'addressFulfillmentCheck'], data: [], actions: [] },
  '03-ton-kho-dia-chi-va-cua-hang.json#5': { kinds: ['addressFulfillmentCheck', 'orderReviewConfirm'], data: ['data.fulfillment'], actions: [] },
  '03-ton-kho-dia-chi-va-cua-hang.json#7': { kinds: ['addressFulfillmentCheck'], data: ['data.fulfillment'], actions: [] },
  '03-ton-kho-dia-chi-va-cua-hang.json#9': { kinds: ['addressFulfillmentCheck'], data: ['data.addressStatus'], actions: ['submit_address'] },
  '08-thanh-toan-loi-va-don-bat-thuong.json#1': { kinds: ['paymentOrderStatus', 'supportHandoff'], data: [], actions: [] },
  '08-thanh-toan-loi-va-don-bat-thuong.json#3': { kinds: ['paymentOrderStatus', 'supportHandoff'], data: [], actions: [] },
  '08-thanh-toan-loi-va-don-bat-thuong.json#5': { kinds: ['supportHandoff'], data: ['data.handoff'], actions: ['send_issue_summary'] },
  '08-thanh-toan-loi-va-don-bat-thuong.json#7': { kinds: ['supportHandoff', 'paymentOrderStatus'], data: [], actions: [] },
  '09-phuong-thuc-thanh-toan.json#1': { kinds: ['paymentMethodPicker'], data: ['data.methods'], actions: ['select_payment_method'] },
  '09-phuong-thuc-thanh-toan.json#3': { kinds: ['paymentMethodPicker'], data: ['data.methods'], actions: ['select_payment_method'] },
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
  const allState = ['cart', 'address', 'fulfillment', 'order', 'paymentAttempt', 'handoff'] as const;
  const mustNotChange = [...new Set((expectation.forbiddenTools ?? [])
    .map((tool) => mutableStateByTool[tool]).filter(Boolean))] as ScenarioTurnOracle['stateTransition']['mustNotChange'];
  const mayChange = allState.filter((key) => !mustNotChange.includes(key));
  const mustChange = [...new Set(individuallyRequiredTools
    .map((tool) => requiredStateChangeByTool[tool]).filter(Boolean))] as ScenarioTurnOracle['stateTransition']['mustChange'];
  const allowedWidgetKinds = [...new Set([
    ...(targetWidgetKinds ?? []),
    ...expectation.allowedTools.flatMap((toolName) => widgetKindsByTool[toolName] ?? []),
  ])].filter((kind) => !forbiddenWidgetKinds?.includes(kind));
  const rowId = `${fileName}#${expectation.turnIndex}`;
  const exactGenUi = exactGenUiByRow[rowId];
  const providerTools = expectation.allowedTools.filter((toolName) => providerBackedTools.has(toolName));
  const hasProviderWork = (expectation.requiredGroups ?? []).some((group) =>
    group.length > 0 && group.every((toolName) => providerBackedTools.has(toolName)),
  );
  const preconditions = [
    'scenario_fixture_loaded',
    ...(fileName.startsWith('03-') || fileName.startsWith('04-') || fileName.startsWith('07-') || fileName.startsWith('08-') ? ['customer_access_bound'] : []),
    ...(fileName.startsWith('04-') ? ['paid_order_seeded'] : []),
    ...(fileName.startsWith('08-') ? ['pending_payment_seeded'] : []),
    ...(hasProviderWork ? ['environment_bound', 'catalog_observation_bound'] : []),
  ];
  return {
    ...expectation,
    id: rowId,
    input: scenarioInputs[fileName]?.[expectation.turnIndex] ?? '',
    preconditions,
    evidenceBindings: [
      'scenario_id', 'turn_index', 'checkpoint_namespace',
      ...(hasProviderWork ? ['catalog_observation', 'provider_revision'] : []),
      ...(fileName.startsWith('08-') ? ['lifecycle_scenario_instance'] : []),
    ],
    toolCounts: expectation.allowedTools.map((toolName) => ({
      toolName, min: individuallyRequiredTools.includes(toolName) ? 1 : 0,
    })),
    toolOrder: individuallyRequiredTools,
    toolOrderGroups: expectation.requiredGroups ?? [],
    argumentConstraints: expectation.allowedTools.flatMap((toolName) =>
      argumentPathsByTool[toolName] ? [{ toolName, requiredPaths: argumentPathsByTool[toolName]! }] : []),
    stateTransition: { mayChange, mustChange, mustNotChange },
    claims: {
      required: (expectation.requiredGroups?.length ?? 0) > 0
        ? [{
            kind: 'grounded_tool_outcome' as const,
            anyOf: expectation.allowedTools,
            statePaths: [...new Set(expectation.allowedTools.flatMap((toolName) => responseEvidenceByTool[toolName].state))],
            genUiPaths: [...new Set(expectation.allowedTools.flatMap((toolName) => responseEvidenceByTool[toolName].genUi))],
            textAnyOf: [...new Set(expectation.allowedTools.flatMap((toolName) => responseEvidenceByTool[toolName].text))],
          }]
        : [{ kind: 'safe_customer_response' as const }],
      forbidden: ['toolTrace', 'checkpoint_ns', 'fixtureMode', 'resultSummary', 'providerFingerprint'],
    },
    genUi: {
      required: Boolean(exactGenUi),
      allowedWidgetKinds: [...new Set([...(exactGenUi?.kinds ?? []), ...allowedWidgetKinds])],
      requiredDataPaths: ['id', 'lifecycleStage', 'widgetKind', 'status', 'data', 'actions', ...(exactGenUi?.data ?? [])],
      requiredActions: exactGenUi?.actions ?? [],
      forbiddenActions: forbiddenWidgetKinds?.map((kind) => `widget:${kind}`) ?? [],
    },
    messenger: { projection: 'semantic_parity', forbiddenText: ['GenUI', 'widgetKind', 'toolTrace', 'checkpoint'] },
    providerEvidence: { requireToolProvenance: hasProviderWork, requireRevisionOrSource: hasProviderWork, providerTools },
    persistenceEvidence: { transcriptDelta: 2, contiguousEvents: true, checkpointRequired: true },
    latency: { maxTurnMs: expectation.allowedTools.some((tool) => ['getOrderStatus', 'checkPaymentStatus'].includes(tool)) ? 5_000 : 10_000 },
    artifacts: [
      'transcript', 'tool_trace', 'checkpoint', 'messenger_projection',
      ...(hasProviderWork ? ['provider_evidence' as const] : []),
      ...(allowedWidgetKinds.length > 0 ? ['genui' as const] : []),
    ],
  };
}

export const liveScenarioCases: LiveScenarioCase[] = baseLiveScenarioCases.map((scenarioCase) => ({
  ...scenarioCase,
  turnExpectations: scenarioCase.turnExpectations.map((expectation) => completeOracle(
    scenarioCase.fileName,
    scenarioCase.targetWidgetKinds,
    scenarioCase.forbiddenWidgetKinds,
    expectation,
  )),
}));
