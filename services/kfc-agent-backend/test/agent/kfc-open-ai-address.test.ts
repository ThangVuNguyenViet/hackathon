import { describe, expect, it, vi } from 'vitest';
import {
  createKfcOpenAiTools as createKfcOpenAiToolsFactory,
  createKfcToolSession,
  hydrateKfcToolSession,
  type CreateKfcOpenAiToolsInput,
  verifiedKfcToolSessionContext,
} from '../../src/agent/kfcOpenAiTools.js';
import type { DeliveryAddressDraft } from '../../src/domain/types.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function createKfcOpenAiTools(
  input: Omit<CreateKfcOpenAiToolsInput, 'fixtures'> &
    Partial<Pick<CreateKfcOpenAiToolsInput, 'fixtures'>>,
) {
  return createKfcOpenAiToolsFactory({
    ...input,
    fixtures: input.fixtures ?? createTestFixtures(),
  });
}

const emptyAddressUpdate = {
  recipientName: null,
  phone: null,
  addressLine: null,
  provinceCode: null,
  provinceName: null,
  communeCode: null,
  communeName: null,
  deliveryInstructions: null,
  rawAddress: null,
  legacyDistrictText: null,
};

async function addressTool(sessionId: string) {
  const fixtures = createTestFixtures();
  const clients = createMockClients(fixtures);
  const session = await createKfcToolSession(clients, sessionId);
  const sessionState = { current: session };
  const quoteFulfillment = createKfcOpenAiTools({
    clients,
    sessionState,
    fixtures,
  }).find((tool) => tool.definition.name === 'quoteFulfillment');
  const updateCart = createKfcOpenAiTools({ clients, sessionState }).find(
    (tool) => tool.definition.name === 'updateCart',
  );
  if (!quoteFulfillment) throw new Error('quoteFulfillment missing');
  if (!updateCart) throw new Error('updateCart missing');
  await updateCart.execute({
    changes: [{ itemCode: '20751', orderedMenuItemQuantity: 1 }],
  });
  return { sessionState, quoteFulfillment };
}

describe('direct OpenAI delivery address flow', () => {
  it('does not clone the Worker external call context before executing a tool', async () => {
    const originalStructuredClone = globalThis.structuredClone;
    const structuredCloneSpy = vi
      .spyOn(globalThis, 'structuredClone')
      .mockImplementation((value, options) => {
        if (
          typeof value === 'object' &&
          value !== null &&
          'externalCallContext' in value
        ) {
          throw new DOMException(
            'AbortSignal could not be cloned',
            'DataCloneError',
          );
        }
        return originalStructuredClone(value, options);
      });

    try {
      const { quoteFulfillment } = await addressTool(
        'kfc:worker_clone_boundary',
      );
      await expect(
        quoteFulfillment.execute({
          method: 'delivery',
          address: {
            ...emptyAddressUpdate,
            recipientName: 'Minh',
            phone: '0900000000',
            addressLine: '54/2 Nguyễn Hồng Đào',
            communeName: 'Phường 14',
            provinceName: 'TP.HCM',
            legacyDistrictText: 'Quận Tân Bình',
          },
        }),
      ).resolves.toMatchObject({
        ok: true,
        toolName: 'quoteFulfillment',
      });
    } finally {
      structuredCloneSpy.mockRestore();
    }
  });

  it('exposes a strict partial structured address schema to the model', async () => {
    const { quoteFulfillment } = await addressTool('kfc:address_schema');
    const parameters = quoteFulfillment.definition.parameters;
    if (
      typeof parameters !== 'object' ||
      parameters === null ||
      !('properties' in parameters) ||
      typeof parameters.properties !== 'object' ||
      parameters.properties === null ||
      !('address' in parameters.properties)
    ) {
      throw new Error('quoteFulfillment address schema missing');
    }
    const address = parameters.properties.address;

    expect(quoteFulfillment.definition.strict).toBe(true);
    expect(address).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: [
        'recipientName',
        'phone',
        'addressLine',
        'provinceCode',
        'provinceName',
        'communeCode',
        'communeName',
        'deliveryInstructions',
        'rawAddress',
        'legacyDistrictText',
      ],
    });
  });

  it('resolves fixture-declared natural administrative abbreviations before quoting', async () => {
    const { sessionState, quoteFulfillment } = await addressTool(
      'kfc:address_partial',
    );

    const first = await quoteFulfillment.execute({
      method: 'delivery',
      address: {
        ...emptyAddressUpdate,
        addressLine: '54/2 Nguyễn Hồng Đào',
        communeName: 'p14',
        provinceName: 'tp HCM',
        legacyDistrictText: 'q Tân Bình',
        rawAddress: '54/2 Nguyễn Hồng Đào p14 q Tân Bình tp HCM',
      },
    });
    const second = await quoteFulfillment.execute({
      method: 'delivery',
      address: {
        ...emptyAddressUpdate,
        recipientName: 'Nguyễn An',
        phone: '0901234567',
      },
    });

    expect(first).toMatchObject({
      ok: true,
      toolName: 'quoteFulfillment',
      value: {
        status: 'incomplete',
        missingFields: ['recipientName', 'phone'],
        addressDraft: {
          addressLine: '54/2 Nguyễn Hồng Đào',
          communeName: 'Phường Tân Bình',
          provinceName: 'Thành phố Hồ Chí Minh',
        },
      },
    });
    expect(second).toMatchObject({
      ok: true,
      toolName: 'quoteFulfillment',
      value: {
        status: 'quoted',
        missingFields: [],
        addressDraft: {
          recipientName: 'Nguyễn An',
          phone: '0901234567',
          addressLine: '54/2 Nguyễn Hồng Đào',
          communeName: 'Phường Tân Bình',
          provinceName: 'Thành phố Hồ Chí Minh',
        },
        fulfillment: {
          method: 'delivery',
          storeId: 'KFCVN0005',
          feeVnd: 18000,
          etaMinutes: 35,
        },
      },
    });
    expect(sessionState.current.deliveryAddressDraft).toMatchObject({
      recipientName: 'Nguyễn An',
      phone: '0901234567',
      addressLine: '54/2 Nguyễn Hồng Đào',
      communeName: 'Phường Tân Bình',
      provinceName: 'Thành phố Hồ Chí Minh',
    });
  });

  it('resolves fixture-declared aliases from the preserved raw address when structured administrative fields are absent', async () => {
    const { quoteFulfillment } = await addressTool('kfc:address_raw_aliases');

    const result = await quoteFulfillment.execute({
      method: 'delivery',
      address: {
        ...emptyAddressUpdate,
        addressLine: '54/2 Nguyễn Hồng Đào',
        rawAddress: '54/2 Nguyễn Hồng Đào p14 q Tân Bình tp HCM',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      toolName: 'quoteFulfillment',
      value: {
        status: 'incomplete',
        missingFields: ['recipientName', 'phone'],
        addressDraft: {
          addressLine: '54/2 Nguyễn Hồng Đào',
          communeName: 'Phường Tân Bình',
          provinceName: 'Thành phố Hồ Chí Minh',
        },
      },
    });
  });

  it('resolves fixture-declared aliases from addressLine when rawAddress is absent', async () => {
    const { quoteFulfillment } = await addressTool('kfc:address_line_aliases');

    const result = await quoteFulfillment.execute({
      method: 'delivery',
      address: {
        ...emptyAddressUpdate,
        addressLine: '54/2 Nguyễn Hồng Đào p14 q Tân Bình tp HCM',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      toolName: 'quoteFulfillment',
      value: {
        status: 'incomplete',
        missingFields: ['recipientName', 'phone'],
        addressDraft: {
          addressLine: '54/2 Nguyễn Hồng Đào p14 q Tân Bình tp HCM',
          communeCode: '27004',
          communeName: 'Phường Tân Bình',
          provinceCode: '79',
          provinceName: 'Thành phố Hồ Chí Minh',
        },
      },
    });
  });

  it('canonical structured fields replace stale missing state and publish a quote', async () => {
    const { sessionState, quoteFulfillment } = await addressTool(
      'kfc:address_structured_repair',
    );
    sessionState.current = {
      ...sessionState.current,
      deliveryAddressDraft: {
        recipientName: 'Nguyễn An',
        phone: '0901234567',
        addressLine: '54/2 Nguyễn Hồng Đào',
        rawAddress: '54/2 Nguyễn Hồng Đào p14 q Tân Bình tp HCM',
        legacyDistrictText: 'Quận Tân Bình',
      },
      deliveryAddressStatus: 'incomplete',
      deliveryAddressMissingFields: ['addressLine'],
    };

    const result = await quoteFulfillment.execute({
      method: 'delivery',
      address: {
        ...emptyAddressUpdate,
        provinceCode: '79',
        provinceName: 'Thành phố Hồ Chí Minh',
        communeCode: '27004',
        communeName: 'Phường Tân Bình',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      toolName: 'quoteFulfillment',
      value: {
        status: 'quoted',
        missingFields: [],
        addressDraft: {
          recipientName: 'Nguyễn An',
          phone: '0901234567',
          addressLine: '54/2 Nguyễn Hồng Đào',
          provinceCode: '79',
          provinceName: 'Thành phố Hồ Chí Minh',
          communeCode: '27004',
          communeName: 'Phường Tân Bình',
        },
        fulfillment: {
          method: 'delivery',
          storeId: 'KFCVN0005',
          feeVnd: 18_000,
          etaMinutes: 35,
        },
      },
    });
    expect(sessionState.current.deliveryAddressStatus).toBe('quoted');
    expect(sessionState.current.deliveryAddressMissingFields).toEqual([]);
    expect(
      verifiedKfcToolSessionContext(sessionState.current),
    ).not.toHaveProperty('deliveryAddressMissingFields');
  });

  it('quotes any complete customer address without administrative validation', async () => {
    const { quoteFulfillment } = await addressTool('kfc:address_unrestricted');

    const result = await quoteFulfillment.execute({
      method: 'delivery',
      address: {
        ...emptyAddressUpdate,
        recipientName: 'Nguyễn An',
        phone: '0901234567',
        addressLine: '1 Tràng Tiền',
        communeName: 'Khu vực khách nhập',
        provinceName: 'Địa phương khách nhập',
        rawAddress: 'Nguyễn An, 0901234567, 1 Tràng Tiền, Hoàn Kiếm, Hà Nội',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      toolName: 'quoteFulfillment',
      value: {
        status: 'quoted',
        missingFields: [],
        addressDraft: {
          recipientName: 'Nguyễn An',
          phone: '0901234567',
          addressLine: '1 Tràng Tiền',
          communeName: 'Khu vực khách nhập',
          provinceName: 'Địa phương khách nhập',
        },
        fulfillment: {
          method: 'delivery',
          feeVnd: expect.any(Number),
        },
      },
    });
  });

  it('quotes a free-form address without requiring province or commune fields', async () => {
    const { quoteFulfillment } = await addressTool('kfc:address_free_form');

    const result = await quoteFulfillment.execute({
      method: 'delivery',
      address: {
        ...emptyAddressUpdate,
        recipientName: 'Nguyễn An',
        phone: '0901234567',
        addressLine: 'Hẻm cạnh trường tiểu học, căn nhà cửa xanh',
        rawAddress:
          'Nguyễn An, 0901234567, hẻm cạnh trường tiểu học, căn nhà cửa xanh',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      toolName: 'quoteFulfillment',
      value: {
        status: 'quoted',
        missingFields: [],
        fulfillment: {
          method: 'delivery',
          feeVnd: expect.any(Number),
        },
      },
    });
  });

  it('quotes a complete address and retains the canonical draft', async () => {
    const { sessionState, quoteFulfillment } =
      await addressTool('kfc:address_quoted');

    const result = await quoteFulfillment.execute({
      method: 'delivery',
      address: {
        ...emptyAddressUpdate,
        recipientName: 'Nguyễn An',
        phone: '0901234567',
        addressLine: '60 Phạm Văn Nghị',
        communeName: 'Phường Tân Hưng',
        provinceName: 'Hồ Chí Minh',
        legacyDistrictText: 'Quận 7',
        deliveryInstructions: 'Gọi khi đến',
        rawAddress:
          'Nguyễn An, 0901234567, 60 Phạm Văn Nghị, Phường Tân Phong, Quận 7, Hồ Chí Minh',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      toolName: 'quoteFulfillment',
      value: {
        status: 'quoted',
        missingFields: [],
        fulfillment: {
          method: 'delivery',
          feeVnd: expect.any(Number),
        },
      },
    });
    expect(sessionState.current.fulfillment).toMatchObject({
      method: 'delivery',
      feeVnd: expect.any(Number),
    });
    expect(sessionState.current.cart).toMatchObject({
      subtotalVnd: 99_000,
      discountVnd: 0,
      deliveryFeeVnd: 18_000,
      totalVnd: 117_000,
    });
    expect(
      sessionState.current.deliveryAddressDraft?.deliveryInstructions,
    ).toBe('Gọi khi đến');
  });

  it('hydrates and publishes an address draft across direct Responses turns', async () => {
    const clients = createMockClients(createTestFixtures());
    const fresh = await createKfcToolSession(clients, 'kfc:address_hydrate');
    const draft: DeliveryAddressDraft = {
      addressLine: '54/2 Nguyễn Hồng Đào',
      communeName: 'Phường 14',
      provinceName: 'TP Hồ Chí Minh',
      rawAddress: '54/2 Nguyễn Hồng Đào p14 tp HCM',
    };

    const hydrated = hydrateKfcToolSession(fresh, {
      deliveryAddressDraft: draft,
    });

    expect(hydrated.deliveryAddressDraft).toEqual(draft);
    expect(verifiedKfcToolSessionContext(hydrated)).toMatchObject({
      deliveryAddressDraft: draft,
    });
  });
});
