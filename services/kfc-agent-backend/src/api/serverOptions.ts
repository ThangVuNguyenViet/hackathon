import type { BuildServerOptions } from "./server.js";
import type { AppEnv } from "../config/env.js";
import { OpenAIMonitorJudge } from "../llm/monitorJudge.js";
import { OpenAIResponseComposer } from "../llm/responseComposer.js";
import { OpenAIToolPlanner } from "../llm/toolPlanner.js";
import { createKfcCommerceGatewayClients } from "../clients/kfcCommerceGateway.js";
import { createHttpPosClient } from "../commerce/httpPosClient.js";
import { createOmsWithPos } from "../commerce/omsWithPos.js";
import type { Order } from "../domain/types.js";

function optionalValue(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function buildServerOptionsFromEnv(env: AppEnv): BuildServerOptions {
  const openAiApiKey = optionalValue(env.OPENAI_API_KEY);
  const openAiBaseUrl = optionalValue(env.OPENAI_BASE_URL);
  const commerceBaseUrl = optionalValue(env.KFC_COMMERCE_GATEWAY_BASE_URL);
  const commerceToken = optionalValue(env.KFC_COMMERCE_GATEWAY_TOKEN);
  const posBaseUrl = optionalValue(env.KFC_POS_BASE_URL);
  const posToken = optionalValue(env.KFC_POS_TOKEN);
  const commerceGateway =
    env.KFC_COMMERCE_MODE === "gateway" && commerceBaseUrl && commerceToken
      ? createKfcCommerceGatewayClients({
          baseUrl: commerceBaseUrl,
          token: commerceToken,
        })
      : undefined;
  const posClient =
    env.KFC_POS_MODE === "http" && posBaseUrl && posToken
      ? createHttpPosClient({ baseUrl: posBaseUrl, token: posToken })
      : undefined;
  const paidProofOrder = proofOrder("KFC-1024", "preparing", "paid");
  const failedPaymentProofOrder = proofOrder(
    "KFC-MOCK-1001",
    "created",
    "pending",
  );
  return {
    messengerVerifyToken: optionalValue(env.MESSENGER_VERIFY_TOKEN),
    metaPageId: optionalValue(env.META_PAGE_ID),
    messengerPageAccessToken: optionalValue(env.META_PAGE_ACCESS_TOKEN),
    metaInboxUrlTemplate: optionalValue(env.META_INBOX_URL_TEMPLATE),
    messengerGraphApiBaseUrl: optionalValue(env.MESSENGER_GRAPH_API_BASE_URL),
    zaloOaId: optionalValue(env.ZALO_OA_ID),
    zaloAccessToken: optionalValue(env.ZALO_ACCESS_TOKEN),
    zaloInboxUrlTemplate: optionalValue(env.ZALO_INBOX_URL_TEMPLATE),
    zaloApiBaseUrl: optionalValue(env.ZALO_API_BASE_URL),
    responseComposer: openAiApiKey
      ? new OpenAIResponseComposer({
          apiKey: openAiApiKey,
          model: env.OPENAI_RESPONSE_MODEL,
          baseUrl: openAiBaseUrl,
        })
      : undefined,
    toolPlanner: openAiApiKey
      ? new OpenAIToolPlanner({
          apiKey: openAiApiKey,
          model: env.OPENAI_TOOL_PLANNER_MODEL,
          baseUrl: openAiBaseUrl,
        })
      : undefined,
    monitorJudge: openAiApiKey
      ? new OpenAIMonitorJudge({
          apiKey: openAiApiKey,
          model: env.OPENAI_MONITOR_JUDGE_MODEL,
          baseUrl: openAiBaseUrl,
        })
      : undefined,
    mockClientOptions: {
      initialOrders: [paidProofOrder, failedPaymentProofOrder],
      recentOrderProvider: (customerId) => {
        if (customerId.includes("08-thanh-toan-loi-va-don-bat-thuong")) {
          return {
            ok: true,
            value: failedPaymentProofOrder,
            message: "genui_integration_recent_failed_payment_order",
          };
        }
        if (
          customerId.includes("04-sau-khi-dat-don") ||
          customerId.includes("07-ca-nhan-hoa-va-loyalty")
        ) {
          return {
            ok: true,
            value: paidProofOrder,
            message: "genui_integration_recent_paid_order",
          };
        }
        return {
          ok: true,
          value: null,
          message: "genui_integration_no_recent_order_precondition",
        };
      },
      paymentStatusProvider: (orderId) =>
        orderId === failedPaymentProofOrder.id
          ? {
              ok: false,
              errorCode: "payment_failed",
              message: "genui_integration_payment_failed",
            }
          : {
              ok: true,
              value: { status: "paid" },
              message: "genui_integration_payment_paid",
            },
      fulfillmentQuoteProvider: () => ({
        ok: true,
        value: { feeVnd: 18000, etaMinutes: 35 },
        message: "ok",
      }),
    },
    kfcCommerceGateway: commerceGateway
      ? {
          ...commerceGateway,
          oms: posClient
            ? createOmsWithPos({ oms: commerceGateway.oms, pos: posClient })
            : commerceGateway.oms,
        }
      : undefined,
    readiness: {
      commerce: {
        mode: env.KFC_COMMERCE_MODE,
        baseUrl: commerceBaseUrl,
        token: commerceToken,
      },
      pos: {
        mode: env.KFC_POS_MODE,
        baseUrl: posBaseUrl,
        token: posToken,
      },
    },
  };
}

function proofOrder(
  id: string,
  status: Order["status"],
  paymentStatus: Order["paymentStatus"],
): Order {
  return {
    id,
    status,
    paymentStatus,
    assignedStoreId: "store_kfc_nguyen_thi_minh_khai",
    createdAt: "2026-07-09T09:00:00.000Z",
    cart: {
      id: `cart_${id}`,
      items: [
        {
          itemCode: "20751",
          name: "Combo Hợp Gu 99K",
          quantity: 1,
          unitPriceVnd: 99000,
        },
      ],
      subtotalVnd: 99000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 117000,
      voucherCode: null,
    },
  };
}
