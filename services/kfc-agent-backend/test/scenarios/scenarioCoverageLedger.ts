import type { KfcGenUiWidgetKind } from '../../src/genui/kfcGenUi.js';
import type { ToolName } from '../../src/ordering/types.js';

export const SCENARIO_COVERAGE_LEDGER_VERSION = '2026-07-14.2';

export interface TurnExpectation {
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

export const liveScenarioCases: LiveScenarioCase[] = [
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
        allowedTools: ['collectInvoice', 'previewOrder', 'placeOrder', 'createPaymentLink'],
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
      { turnIndex: 5, useCaseIds: ['UC-12'], requiredGroups: [['updateCart']], allowedTools: ['updateCart'], forbiddenTools: ['placeOrder'] },
      { turnIndex: 7, useCaseIds: ['Filler'], requiredGroups: [['updateCart']], allowedTools: ['updateCart'] },
      { turnIndex: 9, useCaseIds: ['UC-10'], requiredGroups: [['updateCart']], allowedTools: ['updateCart'] },
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
        allowedTools: [],
        allowEmptyTools: true,
        requiredCatalogCodes: ['41140'],
        forbiddenTools: ['updateCart', 'quoteFulfillment', 'placeOrder'],
      },
      {
        turnIndex: 3,
        useCaseIds: ['UC-07'],
        requiredGroups: [['updateCart']],
        allowedTools: ['updateCart'],
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
        allowedTools: ['checkStoreAvailability'],
        allowDeterministicExecution: true,
        forbiddenTools: ['placeOrder'],
      },
      { turnIndex: 9, useCaseIds: ['UC-23'], allowedTools: [], allowEmptyTools: true, forbiddenTools: ['quoteFulfillment', 'placeOrder'] },
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
      { turnIndex: 9, useCaseIds: ['UC-20'], requiredGroups: [['getOrderStatus']], allowedTools: ['getOrderStatus'] },
      { turnIndex: 11, useCaseIds: ['UC-20'], requiredGroups: [['getOrderStatus']], allowedTools: ['getOrderStatus'] },
      { turnIndex: 13, useCaseIds: ['UC-22'], allowedTools: [], allowEmptyTools: true, forbiddenTools: ['updateCart', 'placeOrder'] },
      { turnIndex: 15, useCaseIds: ['Filler'], requiredGroups: [['updateCart']], allowedTools: ['updateCart'], allowDeterministicExecution: true, forbiddenTools: ['placeOrder'] },
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
      { turnIndex: 3, useCaseIds: ['UC-32'], requiredGroups: [['getModifierOptions', 'searchContentPolicy', 'answerAllergenQuestion']], allowedTools: ['getModifierOptions', 'searchContentPolicy', 'answerAllergenQuestion'], allowDeterministicExecution: true },
      { turnIndex: 5, useCaseIds: ['UC-33'], allowedTools: [], allowEmptyTools: true, forbiddenTools: cartOrderPaymentTools },
      { turnIndex: 7, useCaseIds: ['UC-34'], allowedTools: [], allowEmptyTools: true, forbiddenTools: ['updateCart', 'placeOrder'] },
      { turnIndex: 9, useCaseIds: ['UC-36'], allowedTools: [], allowEmptyTools: true, forbiddenTools: ['placeOrder', 'createPaymentLink'] },
      { turnIndex: 11, useCaseIds: ['UC-35'], allowedTools: [], allowEmptyTools: true, forbiddenTools: cartOrderPaymentTools },
    ],
  },
  {
    fileName: '07-ca-nhan-hoa-va-loyalty.json',
    targetWidgetKinds: ['cartBuilder'],
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
      { turnIndex: 7, useCaseIds: ['Filler'], allowedTools: [], allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
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
];
